# backend/tests/conftest.py
import io
import pytest
from reportlab.pdfgen import canvas

@pytest.fixture
def sample_pdf_stream():
    """Generates a minimal PDF stream containing extractable text."""
    stream = io.BytesIO()
    c = canvas.Canvas(stream)
    c.drawString(100, 750, "Introduction to Local Search Algorithms and State Space Graphs.")
    c.drawString(100, 730, "State space representation requires defining nodes and edges clearly.")
    c.save()
    stream.seek(0)
    return stream