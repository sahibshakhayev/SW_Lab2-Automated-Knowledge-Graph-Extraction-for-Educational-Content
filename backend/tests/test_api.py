import io
import pytest
from fastapi.testclient import TestClient
from pypdf import PdfWriter
from main import app

client = TestClient(app)

@pytest.fixture
def sample_pdf_stream():
    writer = PdfWriter()
    page = writer.add_blank_page(width=200, height=200)
    buffer = io.BytesIO()
    writer.write(buffer)
    buffer.seek(0)
    return buffer

def test_health_check():
    response = client.get("/api/health")
    assert response.status_code == 200
    assert response.json()["status"] == "ok"

def test_ingest_pdf_success(sample_pdf_stream):
    files = {"file": ("test_lecture.pdf", sample_pdf_stream, "application/pdf")}
    response = client.post("/api/v1/ingest/pdf", files=files)
    
    assert response.status_code == 200
    data = response.json()
    assert data["filename"] == "test_lecture.pdf"
    assert "total_chunks" in data
    assert "total_images_extracted" in data
    assert isinstance(data["chunks"], list)

def test_ingest_pdf_invalid_extension():
    files = {"file": ("test_file.txt", b"Hello world", "text/plain")}
    response = client.post("/api/v1/ingest/pdf", files=files)
    
    assert response.status_code == 400
    assert "Only PDF files are supported" in response.json()["detail"]