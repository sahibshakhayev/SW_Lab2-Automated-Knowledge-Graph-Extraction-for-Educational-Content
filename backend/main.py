from fastapi import Response, FastAPI, UploadFile, File, Form, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from contextlib import asynccontextmanager
from typing import Optional
from pathlib import Path

from app.schemas.graph import UnmergeRequest
from app.services.pdf_service import PDFProcessor
from app.services.llm_service import LLMExtractionService
from app.services.graph_service import GraphService
from app.services.normalization_service import ConceptNormalizer

graph_service = GraphService()
llm_service = LLMExtractionService()
normalizer = ConceptNormalizer()

CACHE_DIR = Path("/tmp/pdf_cache")
CACHE_DIR.mkdir(parents=True, exist_ok=True)


@asynccontextmanager
async def lifespan(app: FastAPI):
    try:
        graph_service.init_constraints()
    except Exception as e:
        print(f"[Neo4j Startup Warning]: {e}")
    yield
    graph_service.close()


app = FastAPI(title="Educational Knowledge Graph Engine", lifespan=lifespan)

# Enable CORS for Next.js dev server
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/api/health")
def health_check():
    return {"status": "ok", "message": "FastAPI Knowledge Graph Engine running"}


@app.post("/api/v1/extract")
async def extract_and_persist_graph(
    file: UploadFile = File(...),
    append_mode: bool = Form(False),
):
    if not file.filename.endswith(".pdf"):
        raise HTTPException(status_code=400, detail="Only PDF slide decks are supported.")

    contents = await file.read()
    file_path = CACHE_DIR / file.filename
    with open(file_path, "wb") as f:
        f.write(contents)

    chunks, total_images = PDFProcessor.extract_chunks_from_pdf(contents, file.filename)
    if not chunks:
        raise HTTPException(status_code=400, detail="Could not parse text chunks from uploaded PDF.")

    # Step 1: Raw LLM Graph Extraction (DeepSeek via OpenRouter)
    raw_graph = llm_service.extract_graph_from_chunks(chunks, file.filename)

    # Step 2: Vector Normalization, Disambiguation & Cycle Breaking
    normalized_concepts, normalized_relations, analytics = normalizer.normalize_graph(
        raw_graph.concepts,
        raw_graph.relationships,
    )

    # Step 3: Persistence to Neo4j Graph DB
    if not append_mode:
        graph_service.clear_graph()

    persistence_summary = graph_service.persist_graph(normalized_concepts, normalized_relations)
    active_ids = None if append_mode else [c.concept_id for c in normalized_concepts]
    dag_status = graph_service.verify_dag_acyclicity(concept_ids=active_ids)

    return {
        "filename": file.filename,
        "comparative_analytics": analytics,
        "persistence": persistence_summary,
        "topology_check": dag_status,
        "graph": {
            "concepts": normalized_concepts,
            "relationships": normalized_relations,
        },
    }


@app.get("/api/v1/graph/learning-path")
async def get_learning_path(target_id: Optional[str] = None):
    """Returns a topologically sorted prerequisite learning path (full graph or up to target_id)."""
    try:
        return graph_service.get_learning_path(target_concept_id=target_id)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to compute learning path: {str(e)}")


@app.get("/api/v1/slides/{filename}/{page_num}")
async def get_slide_image(filename: str, page_num: int):
    """Returns rendered PNG image of the requested PDF slide page."""
    file_path = CACHE_DIR / filename
    if not file_path.exists():
        raise HTTPException(status_code=404, detail=f"PDF '{filename}' not found in cache. Please re-upload.")

    with open(file_path, "rb") as f:
        pdf_bytes = f.read()

    png_bytes = PDFProcessor.render_slide_page(pdf_bytes, page_num)
    return Response(content=png_bytes, media_type="image/png")


@app.post("/api/v1/graph/inject-cycle")
async def inject_test_cycle(source_id: str, target_id: str):
    """Demo Endpoint: Injects a cyclic prerequisite edge to demonstrate cycle detection (>0 cycles)."""
    query = """
    MATCH (a:Concept {id: $source}), (b:Concept {id: $target})
    MERGE (a)-[r:PREREQUISITE_OF]->(b)
    RETURN r
    """
    graph_service.run_query(query, {"source": source_id, "target": target_id})
    return graph_service.verify_dag_acyclicity()


@app.delete("/api/v1/graph/edge")
async def delete_prerequisite_edge(source_id: str, target_id: str):
    """Deletes a specific PREREQUISITE_OF edge to manually resolve a cycle or bad link."""
    try:
        query = """
        MATCH (a:Concept {id: $source})-[r:PREREQUISITE_OF]->(b:Concept {id: $target})
        DELETE r
        RETURN count(r) AS deleted_count
        """
        res = graph_service.run_query(query, {"source": source_id, "target": target_id})
        deleted = res[0]["deleted_count"] if res else 0
        if deleted == 0:
            raise HTTPException(status_code=404, detail="Prerequisite edge not found.")

        dag_status = graph_service.verify_dag_acyclicity()
        return {
            "status": "success",
            "deleted": {"source": source_id, "target": target_id},
            "topology_check": dag_status,
        }
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to delete edge: {str(e)}")


@app.get("/api/v1/graph")
async def fetch_graph(limit: Optional[int] = Query(default=100, ge=1, le=1000)):
    """Fetches the full persisted Knowledge Graph structure from Neo4j for frontend rendering."""
    try:
        nodes, edges = graph_service.get_full_graph(limit=limit)
        return {
            "total_nodes": len(nodes),
            "total_edges": len(edges),
            "graph": {
                "concepts": nodes,
                "relationships": edges,
            },
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to fetch graph from Neo4j: {str(e)}")


@app.post("/api/v1/graph/unmerge")
async def unmerge_synonym_cluster(payload: UnmergeRequest):
    """Manually splits an algorithmically merged concept back into a standalone entity."""
    try:
        unmerged_id = payload.target_synonym_name.lower().replace(" ", "_").replace("-", "_")

        # Detach in Neo4j
        graph_service.unmerge_concept(payload.canonical_id, payload.target_synonym_name)

        return {
            "status": "success",
            "message": f"Unmerged '{payload.target_synonym_name}' from '{payload.canonical_id}'",
            "unmerged_concept": {
                "concept_id": unmerged_id,
                "name": payload.target_synonym_name,
                "description": f"Manually unmerged concept split from {payload.canonical_id}.",
                "source_slides": [1],
            },
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to unmerge cluster: {str(e)}")