# backend/tests/conftest.py
import io
import pytest
from pypdf import PdfWriter

@pytest.fixture
def sample_pdf_stream():
    """Generates a minimal, valid in-memory PDF stream for testing."""
    writer = PdfWriter()
    writer.add_blank_page(width=612, height=792)
    
    stream = io.BytesIO()
    writer.write(stream)
    stream.seek(0)
    return stream