import pytest
from app.schemas.document import DocumentChunk, ExtractedImage, DocumentIngestionResponse

def test_document_chunk_defaults():
    chunk = DocumentChunk(
        chunk_id="test_pdf_page_1",
        page_number=1,
        content="Artificial Intelligence Lecture 1"
    )
    assert chunk.chunk_id == "test_pdf_page_1"
    assert chunk.page_number == 1
    assert chunk.has_images is False
    assert chunk.images == []
    assert chunk.token_count is None

def test_document_chunk_with_image():
    image = ExtractedImage(
        image_id="test_img_1",
        page_number=1,
        format="png",
        base64_data="data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
        width=100.0,
        height=50.0
    )
    chunk = DocumentChunk(
        chunk_id="test_pdf_page_1",
        page_number=1,
        content="Slide with Diagram",
        has_images=True,
        images=[image]
    )
    assert chunk.has_images is True
    assert len(chunk.images) == 1
    assert chunk.images[0].format == "png"

def test_ingestion_response_schema():
    response = DocumentIngestionResponse(
        filename="lecture.pdf",
        total_pages=1,
        total_chunks=1,
        total_images_extracted=0,
        chunks=[]
    )
    assert response.filename == "lecture.pdf"
    assert response.total_images_extracted == 0