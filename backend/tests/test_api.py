# backend/tests/test_api.py
from fastapi.testclient import TestClient
from main import app

client = TestClient(app)

def test_health_check():
    response = client.get("/api/health")
    assert response.status_code == 200
    assert response.json()["status"] == "ok"

def test_extract_graph_success(sample_pdf_stream):
    files = {"file": ("test_lecture.pdf", sample_pdf_stream, "application/pdf")}
    response = client.post("/api/v1/extract/graph", files=files)
    
    assert response.status_code == 200
    data = response.json()
    assert "filename" in data
    assert "extracted_graph" in data

def test_extract_graph_invalid_extension():
    files = {"file": ("test_file.txt", b"Hello world", "text/plain")}
    response = client.post("/api/v1/extract/graph", files=files)
    
    assert response.status_code == 400
    assert response.json()["detail"] == "Only PDF files are supported."