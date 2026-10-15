# Educational Knowledge Graph Extraction Platform

An end-to-end full-stack application designed to automatically ingest educational course materials (e.g., lecture PDFs, slides), extract key domain concepts and prerequisite relationships using Large Language Models (LLMs), and generate interactive Knowledge Graphs for Learning Management Systems (LMS).

Developed as part of the Master's Thesis Research and Software Lab II at ELTE.

---

## 🏗️ Tech Stack & Architecture

The system is designed as a fully containerized monorepo separated into three distinct layers:

- **Frontend:** Next.js (TypeScript, App Router, Tailwind CSS) for dashboard UI and interactive graph visualizations (Cytoscape.js / vis.js).
- **Backend:** FastAPI (Python 3.11) microservice handling PDF document parsing (`pdfplumber`), multimodal image extraction (`Pillow`), text chunking, and LLM orchestration.
- **Database:** Neo4j Community Edition (Graph DB) storing Directed Acyclic Graphs (DAGs) of prerequisite concept chains.
- **Infrastructure:** Docker Compose with dedicated multi-stage Development (`docker-compose.dev.yml`) and Production (`docker-compose.prod.yml`) orchestration environments.
- **CI/CD:** GitHub Actions running automated unit tests, Next.js typechecks/builds, and full-stack Docker container verification.

---

## 🚀 Quick Start (Development Mode)

### Prerequisites

- Docker Desktop installed and running.
- Git.

### 1. Clone the Repository

```bash
git clone https://github.com/YOUR_GITHUB_USERNAME/educational-kg-platform.git
cd educational-kg-platform
```

### 2. Launch the Development Stack

Run the development Docker Compose cluster:

```bash
docker compose -f docker-compose.dev.yml up --build
```

This starts all three services concurrently with hot-reloading enabled:

- **Frontend Dashboard:** http://localhost:3000
- **FastAPI Interactive Docs (Swagger):** http://localhost:8000/docs
- **Neo4j Browser Console:** http://localhost:7474 (Login: `neo4j` / Password: `password123`)

---

## 🧪 Running Unit Tests

The backend includes an automated test suite powered by `pytest` and Starlette `TestClient`.

Run all tests inside the active backend container:

```bash
docker exec -it kg_backend_dev pytest -v
```

---

## 🔌 API Reference

### `GET /api/health`

Health check endpoint to verify backend service status.

### `POST /api/v1/ingest/pdf`

Ingests a lecture slide PDF, extracts clean slide text, crops embedded figures/diagrams (> 30 pt bounding box), converts figures to Base64 PNG URIs, and structures slide-level chunks.

- **Request:** `multipart/form-data` with `file: UploadFile`
- **Response Sample:**

```json
{
  "filename": "03.localsearch.pdf",
  "total_pages": 27,
  "total_chunks": 27,
  "total_images_extracted": 9,
  "chunks": [
    {
      "chunk_id": "03.localsearch.pdf_page_2",
      "page_number": 2,
      "content": "DATA := initial value\nwhile termination condition(DATA) loop...",
      "token_count": 73,
      "has_images": true,
      "images": [
        {
          "image_id": "03.localsearch.pdf_p2_img1",
          "page_number": 2,
          "format": "png",
          "base64_data": "data:image/png;base64,iVBORw0KGgoAAA...",
          "width": 229.13,
          "height": 70.12
        }
      ]
    }
  ]
}
```

---

## 👤 Author

- **Sahib Shakhayev** – Master's Student & Lead Developer
- **Supervisor:** Kovan Mzwri
- **Institution:** ELTE (Eötvös Loránd University), Budapest
