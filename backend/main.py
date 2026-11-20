from fastapi import Response, FastAPI, UploadFile, File, Form, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from contextlib import asynccontextmanager
from typing import Optional
from pathlib import Path
import os
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


from typing import Optional
from pydantic import BaseModel


class UnmergeRequest(BaseModel):
    canonical_id: str
    target_synonym_name: str


@app.post("/api/v1/courses/{course_id}/unmerge")
async def unmerge_course_concept(course_id: str, payload: UnmergeRequest):
    try:
        concept = graph_service.unmerge_course_synonym(
            course_id, payload.canonical_id, payload.target_synonym_name
        )
        return {"status": "success", "unmerged_concept": concept}
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


@app.get("/api/v1/evaluate/benchmarks")
async def get_evaluation_benchmarks(course_id: Optional[str] = None):
    """Returns structural topology, node compression, cycle pruning, and DAG depth benchmarks."""
    try:
        return graph_service.compute_graph_benchmarks(course_id=course_id)
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))





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



from app.models.schemas import (
    CourseCreate,
    CourseUpdate,
    ConceptCreateRequest,
    ConceptUpdateRequest,
    ConceptMergeRequest,
    EdgeCreateRequest,
    EdgeUpdateRequest,
    LecturerEvaluationRequest,
)

# ------------------------------------------------------------------
# Course CRUD Endpoints
# ------------------------------------------------------------------
@app.get("/api/v1/courses")
async def list_courses():
    return {"courses": graph_service.list_courses()}


@app.post("/api/v1/courses")
async def create_course(payload: CourseCreate):
    course = graph_service.create_course(payload.code, payload.title, payload.description or "")
    return {"status": "success", "course": course}


@app.put("/api/v1/courses/{course_id}")
async def update_course(course_id: str, payload: CourseUpdate):
    try:
        course = graph_service.update_course(course_id, payload.code, payload.title, payload.description)
        return {"status": "success", "course": course}
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))


@app.delete("/api/v1/courses/{course_id}")
async def delete_course(course_id: str):
    graph_service.delete_course(course_id)
    return {"status": "success"}


@app.get("/api/v1/courses/{course_id}/graph")
async def get_course_graph(course_id: str):
    try:
        return graph_service.get_course_graph(course_id)
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))


# ------------------------------------------------------------------
# Course-Wide PDF Extraction & Multi-Lecture Merging
# ------------------------------------------------------------------
@app.post("/api/v1/courses/{course_id}/extract")
async def extract_into_course(
    course_id: str,
    file: UploadFile = File(...),
    append_mode: bool = Form(True),
):
    if not file.filename or not file.filename.endswith(".pdf"):
        raise HTTPException(status_code=400, detail="Only PDF slide decks are supported.")

    file_bytes = await file.read()

    # Persist PDF in /tmp/pdf_cache for slide rendering
    cache_path = CACHE_DIR / file.filename
    with open(cache_path, "wb") as f:
        f.write(file_bytes)

    chunks, total_images = PDFProcessor.extract_chunks_from_pdf(file_bytes, file.filename)
    if not chunks:
        raise HTTPException(status_code=400, detail="Could not parse text chunks from uploaded PDF.")

    raw_graph = llm_service.extract_graph_from_chunks(chunks, file.filename)

    if not append_mode:
        graph_service.clear_course_graph(course_id)
        existing_concepts = []
    else:
        existing_concepts = graph_service.get_existing_concepts(course_id)

    normalized_concepts, normalized_relations, analytics = normalizer.normalize_graph(
        raw_graph.concepts,
        raw_graph.relationships,
        existing_concepts=existing_concepts,
    )
    full_graph = graph_service.persist_course_extraction(
        course_id=course_id,
        filename=file.filename,
        raw_concepts=raw_graph.concepts,
        raw_relationships=raw_graph.relationships,
        concepts=normalized_concepts,
        relationships=normalized_relations,
        analytics=analytics,
        append_mode=append_mode,
    )

    return {
        "status": "success",
        "comparative_analytics": analytics,
        "graph": full_graph,
        "topology_check": full_graph["topology_check"],
    }
# ------------------------------------------------------------------
# Lecturer Full Graph Control (Concepts & Prerequisite Edges)
# ------------------------------------------------------------------
@app.post("/api/v1/courses/{course_id}/concepts")
async def add_course_concept(course_id: str, payload: ConceptCreateRequest):
    concept = graph_service.create_concept(
        course_id,
        payload.name,
        payload.description,
        payload.domain or "General",
        payload.source_slides,
        payload.source_file or "Lecturer Manual Entry",
    )
    return {"status": "success", "concept": concept}


@app.put("/api/v1/courses/{course_id}/concepts/{concept_id}")
async def edit_course_concept(course_id: str, concept_id: str, payload: ConceptUpdateRequest):
    try:
        concept = graph_service.update_concept(
            course_id, concept_id, payload.name, payload.description, payload.domain or "General", payload.source_slides
        )
        return {"status": "success", "concept": concept}
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))


@app.delete("/api/v1/courses/{course_id}/concepts/{concept_id}")
async def remove_course_concept(course_id: str, concept_id: str):
    graph_service.delete_concept(course_id, concept_id)
    return {"status": "success"}


@app.post("/api/v1/courses/{course_id}/concepts/merge")
async def merge_course_concepts(course_id: str, payload: ConceptMergeRequest):
    try:
        graph_service.merge_concepts(course_id, payload.source_concept_id, payload.target_concept_id)
        return {"status": "success", "graph": graph_service.get_course_graph(course_id)}
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


@app.post("/api/v1/courses/{course_id}/edges")
async def add_course_edge(course_id: str, payload: EdgeCreateRequest):
    try:
        edge = graph_service.create_edge(course_id, payload.source_concept_id, payload.target_concept_id, payload.reasoning)
        return {"status": "success", "edge": edge, "topology_check": graph_service.verify_dag_acyclicity(course_id)}
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


@app.put("/api/v1/courses/{course_id}/edges")
async def edit_course_edge(course_id: str, payload: EdgeUpdateRequest):
    try:
        edge = graph_service.update_edge(
            course_id, payload.source_concept_id, payload.target_concept_id, payload.reasoning, payload.reverse_direction
        )
        return {"status": "success", "edge": edge, "topology_check": graph_service.verify_dag_acyclicity(course_id)}
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


@app.delete("/api/v1/courses/{course_id}/edges")
async def remove_course_edge(course_id: str, source_id: str, target_id: str):
    graph_service.delete_edge(course_id, source_id, target_id)
    return {"status": "success", "topology_check": graph_service.verify_dag_acyclicity(course_id)}


# ------------------------------------------------------------------
# Lecturer Evaluation & Gold-Standard Sign-Off
# ------------------------------------------------------------------
@app.get("/api/v1/courses/{course_id}/evaluation")
async def get_course_evaluation(course_id: str):
    try:
        return graph_service.get_course_evaluation(course_id)
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))


@app.post("/api/v1/courses/{course_id}/evaluation")
async def submit_course_evaluation(course_id: str, payload: LecturerEvaluationRequest):
    try:
        report = graph_service.save_lecturer_evaluation(
            course_id,
            payload.is_verified,
            payload.accuracy_rating,
            payload.completeness_rating,
            payload.pedagogical_clarity_rating,
            payload.lecturer_notes or "",
        )
        return {"status": "success", "evaluation": report}
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))

from fastapi.responses import PlainTextResponse


@app.get("/api/v1/courses/{course_id}/evaluation/ablation")
async def get_course_ablation(course_id: str):
    try:
        return graph_service.compute_ablation_benchmark(course_id)
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))


@app.get("/api/v1/evaluation/cross-course-csv", response_class=PlainTextResponse)
async def export_all_courses_benchmark_csv():
    """Exports a multi-course ablation table (Raw vs. Auto-Normalized vs. Gold Standard) as CSV."""
    courses = graph_service.list_courses()
    lines = [
        "CourseCode,CourseTitle,LecturesCount,VerifiedGoldStandard,"
        "RawNodes,AutoNodes,GoldNodes,CompressionPct,"
        "RawEdges,AutoEdges,GoldEdges,"
        "RawConceptF1,NormConceptF1,RawEdgeF1,NormEdgeF1,RawGED,NormGED"
    ]
    for c in courses:
        b = graph_service.compute_ablation_benchmark(c["id"])
        cnt = b["counts"]
        s1 = b["stage1_raw_vs_gold"]
        s2 = b["stage2_normalized_vs_gold"]
        lines.append(
            f"\"{b['course_code']}\",\"{b['course_title']}\",{len(b['lectures'])},{b['is_verified_gold_standard']},"
            f"{cnt['raw_nodes']},{cnt['auto_nodes']},{cnt['gold_nodes']},{cnt['node_compression_pct']},"
            f"{cnt['raw_edges']},{cnt['auto_edges']},{cnt['gold_edges']},"
            f"{s1['concepts']['f1']},{s2['concepts']['f1']},{s1['edges']['f1']},{s2['edges']['f1']},"
            f"{s1['graph_edit_distance']},{s2['graph_edit_distance']}"
        )
    return "\n".join(lines)