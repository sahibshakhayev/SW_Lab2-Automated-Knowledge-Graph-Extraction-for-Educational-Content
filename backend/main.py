from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi import FastAPI, UploadFile, File, HTTPException
from app.schemas.document import DocumentIngestionResponse, DocumentChunk
from app.services.pdf_service import PDFProcessor

app = FastAPI(title="Educational Knowledge Graph API")


app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.get("/api/health")
def health_check():
    return {"status": "ok", "message": "FastAPI Knowledge Graph Engine is running"}





@app.post("/api/v1/ingest/pdf", response_model=DocumentIngestionResponse)
async def ingest_pdf(file: UploadFile = File(...)):
    if not file.filename.endswith(".pdf"):
        raise HTTPException(status_code=400, detail="Only PDF files are supported.")
    
    contents = await file.read()
    chunks, total_images = PDFProcessor.extract_chunks_from_pdf(contents, file.filename)
    
    return DocumentIngestionResponse(
        filename=file.filename,
        total_pages=len(chunks),
        total_chunks=len(chunks),
        total_images_extracted=total_images,
        chunks=chunks
    )