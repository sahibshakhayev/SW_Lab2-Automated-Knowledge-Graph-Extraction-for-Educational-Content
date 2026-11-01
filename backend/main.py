from fastapi import FastAPI, UploadFile, File, HTTPException
from app.services.pdf_service import PDFProcessor
from app.services.llm_service import LLMExtractionService
from app.services.graph_service import GraphService
from app.services.normalization_service import ConceptNormalizer

app = FastAPI(title="Educational Knowledge Graph Extraction API")

graph_service = GraphService()
llm_service = LLMExtractionService()
normalizer = ConceptNormalizer()



@app.on_event("startup")
def startup_event():
    try:
        graph_service.init_constraints()
    except Exception as e:
        print(f"Neo4j constraint initialization notice: {e}")

@app.get("/api/health")
def health_check():
    return {"status": "ok", "message": "FastAPI Knowledge Graph Engine is running"}

@app.post("/api/v1/extract/graph")
async def extract_and_persist_graph(file: UploadFile = File(...)):
    if not file.filename.endswith(".pdf"):
        raise HTTPException(status_code=400, detail="Only PDF files are supported.")

    # 1. PDF Text Chunking & Image Extraction
    contents = await file.read()
    chunks, total_images = PDFProcessor.extract_chunks_from_pdf(contents, file.filename)

    if not chunks:
        raise HTTPException(status_code=400, detail="Could not extract text chunks from uploaded PDF.")

    # 2. LLM API Call with Pydantic Structured Output Validation
    extracted_graph = llm_service.extract_graph_from_chunks(chunks, file.filename)


    normalized_concepts, normalized_relations, analytics = normalizer.normalize_graph(
       extracted_graph.concepts, 
       extracted_graph.relationships
    )


    persistence_summary = graph_service.persist_graph(
        normalized_concepts, 
        normalized_relations
    )
    dag_status = graph_service.verify_dag_acyclicity()

    return {
        "filename": file.filename,
        "comparative_analytics": analytics, 
        "persistence": persistence_summary,
        "topology_check": dag_status,
        "normalized_graph": {
            "concepts": normalized_concepts,
            "relationships": normalized_relations
        }
        
}