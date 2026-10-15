# Educational Knowledge Graph Extraction Platform
## Comprehensive Setup, Implementation & Verification Guide (Weeks 1 & 2)

---

## 1. Project Overview & Architecture

This repository contains a full-stack, containerized application designed to ingest educational slides/PDFs, perform multimodal text and diagram extraction, and prepare data for Large Language Model (LLM) concept extraction and Neo4j Knowledge Graph generation.

### System Components:
* **Frontend:** Next.js (TypeScript, App Router, Tailwind CSS) — containerized via Node 20 with standalone output support.
* **Backend:** FastAPI (Python 3.11) — microservice executing PDF parsing (`pdfplumber`), image processing (`Pillow`), text chunking, and Pydantic validation.
* **Database:** Neo4j 5 Community Edition — graph database for storing concept nodes and `PREREQUISITE_OF` directed edges.
* **Infrastructure:** Docker Compose (Dev/Prod) and GitHub Actions CI/CD pipeline.

---

## 2. Directory Structure

```text
educational-kg-platform/
├── .github/
│   └── workflows/
│       └── ci.yml                 # Full-Stack GitHub Actions Pipeline
├── backend/
│   ├── app/
│   │   ├── __init__.py
│   │   ├── schemas/
│   │   │   ├── __init__.py
│   │   │   └── document.py        # Pydantic Response & Chunk Schemas
│   │   └── services/
│   │       ├── __init__.py
│   │       └── pdf_service.py     # pdfplumber & Pillow Extraction Pipeline
│   ├── tests/
│   │   ├── __init__.py
│   │   ├── test_schemas.py        # Schema Unit Tests
│   │   ├── test_pdf_service.py    # Service Logic Tests
│   │   └── test_api.py            # FastAPI Endpoint Integration Tests
│   ├── main.py                    # FastAPI Routes & App Entrypoint
│   ├── pytest.ini                 # Pytest Configuration
│   ├── Dockerfile                 # Multi-stage Production Dockerfile
│   ├── Dockerfile.dev             # Hot-reloading Development Dockerfile
│   └── requirements.txt           # Backend Dependencies
├── frontend/
│   ├── src/                       # Next.js Application Source
│   ├── next.config.js             # Next.js Config (output: 'standalone')
│   ├── Dockerfile                 # Production Standalone Dockerfile
│   └── Dockerfile.dev             # Development Dockerfile
├── docker-compose.yml             # Base Service Definitions (Neo4j)
├── docker-compose.dev.yml         # Development Orchestration Setup
├── docker-compose.prod.yml        # Production Orchestration Setup
├── README.md                      # Repository Documentation
└── .gitignore                     # Git Exclusion Rules