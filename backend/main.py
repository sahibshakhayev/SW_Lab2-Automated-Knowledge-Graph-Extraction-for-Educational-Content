from fastapi import FastAPI, UploadFile, File, HTTPException
from app.services.pdf_service import PDFProcessor
from app.services.llm_service import LLMExtractionService
from app.services.graph_service import GraphService

app = FastAPI(title="Educational Knowledge Graph Extraction API")

graph_service = GraphService()
llm_service = LLMExtractionService()

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

    # 3. Auto-Persist Extracted Concepts & Edges to Neo4j
    persistence_summary = graph_service.persist_graph(
        extracted_graph.concepts, 
        extracted_graph.relationships
    )

    # 4. Topological Integrity Check (DAG Validation)
    dag_status = graph_service.verify_dag_acyclicity()

    return {
        "filename": file.filename,
        "chunks_parsed": len(chunks),
        "total_images_extracted": total_images,
        "persistence": persistence_summary,
        "topology_check": dag_status,
        "extracted_graph": extracted_graph
    }