from unittest.mock import patch
from fastapi.testclient import TestClient
from main import app

client = TestClient(app)

def test_health_check():
    response = client.get("/api/health")
    assert response.status_code == 200
    assert response.json()["status"] == "ok"

@patch("main.graph_service.verify_dag_acyclicity")
@patch("main.graph_service.persist_graph")
def test_extract_graph_success(mock_persist, mock_verify, sample_pdf_stream):
    mock_persist.return_value = {"concepts_persisted": 3, "relationships_persisted": 2}
    mock_verify.return_value = {"is_dag": True, "cycle_count": 0}

    files = {"file": ("test_lecture.pdf", sample_pdf_stream, "application/pdf")}
    response = client.post("/api/v1/extract/graph", files=files)

    assert response.status_code == 200
    data = response.json()
    assert data["filename"] == "test_lecture.pdf"
    assert "extracted_graph" in data
    assert data["topology_check"]["is_dag"] is True

def test_extract_graph_invalid_extension():
    files = {"file": ("test_file.txt", b"Hello world", "text/plain")}
    response = client.post("/api/v1/extract/graph", files=files)
    assert response.status_code == 400
    assert response.json()["detail"] == "Only PDF files are supported."