import io
import pytest
from pypdf import PdfWriter
from app.services.pdf_service import PDFProcessor

@pytest.fixture
def sample_pdf_bytes():
    """Generates a simple 2-page in-memory PDF for testing."""
    writer = PdfWriter()
    writer.add_blank_page(width=200, height=200)
    writer.add_blank_page(width=200, height=200)
    
    buffer = io.BytesIO()
    writer.write(buffer)
    return buffer.getvalue()

def test_extract_chunks_empty_or_blank_pdf(sample_pdf_bytes):
    chunks, total_images = PDFProcessor.extract_chunks_from_pdf(sample_pdf_bytes, "blank.pdf")
    # Blank pages without text or images should yield 0 chunks or empty contents
    assert isinstance(chunks, list)
    assert total_images == 0

def test_invalid_pdf_bytes_raises_exception():
    invalid_bytes = b"This is not a real PDF file content"
    with pytest.raises(Exception):
        PDFProcessor.extract_chunks_from_pdf(invalid_bytes, "corrupted.pdf")