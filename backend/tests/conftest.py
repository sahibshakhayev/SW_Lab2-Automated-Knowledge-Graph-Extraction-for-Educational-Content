import io
import pytest
from reportlab.pdfgen import canvas

@pytest.fixture
def sample_pdf_stream():
    stream = io.BytesIO()
    c = canvas.Canvas(stream)
    c.drawString(100, 750, "State Space Search and Local Search Optimization.")
    c.drawString(100, 730, "Hill climbing algorithm operates on a single current node.")
    c.save()
    stream.seek(0)
    return stream