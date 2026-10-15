from pydantic import BaseModel
from typing import List, Optional

class ExtractedImage(BaseModel):
    image_id: str
    page_number: int
    format: str  # e.g., "png", "jpeg"
    base64_data: Optional[str] = None  # Base64 string for direct frontend rendering
    width: Optional[float] = None
    height: Optional[float] = None

class DocumentChunk(BaseModel):
    chunk_id: str
    page_number: int
    content: str
    token_count: Optional[int] = None
    has_images: bool = False
    images: List[ExtractedImage] = []

class DocumentIngestionResponse(BaseModel):
    filename: str
    total_pages: int
    total_chunks: int
    total_images_extracted: int
    chunks: List[DocumentChunk]