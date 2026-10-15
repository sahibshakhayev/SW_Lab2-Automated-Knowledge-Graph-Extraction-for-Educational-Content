import io
import base64
import pdfplumber
from typing import List, Tuple
from PIL import Image
from app.schemas.document import DocumentChunk, ExtractedImage

class PDFProcessor:
    @staticmethod
    def extract_chunks_from_pdf(file_bytes: bytes, filename: str) -> Tuple[List[DocumentChunk], int]:
        chunks = []
        total_images = 0
        
        with pdfplumber.open(io.BytesIO(file_bytes)) as pdf:
            for page_idx, page in enumerate(pdf.pages, start=1):
                # 1. Extract Text
                text = page.extract_text()
                cleaned_text = ""
                if text and text.strip():
                    cleaned_text = "\n".join(
                        [line.strip() for line in text.split("\n") if len(line.strip()) > 3]
                    )
                
                # 2. Extract Images on Current Page
                extracted_images: List[ExtractedImage] = []
                for img_idx, img_obj in enumerate(page.images, start=1):
                    try:
                        # Extract bounding box & crop image from page render
                        bbox = (img_obj["x0"], img_obj["top"], img_obj["x1"], img_obj["bottom"])
                        # Filter out micro-graphics / icons (width & height > 30pt)
                        if (bbox[2] - bbox[0] > 30) and (bbox[3] - bbox[1] > 30):
                            cropped_page = page.crop(bbox)
                            pil_image = cropped_page.to_image(resolution=150).original
                            
                            # Convert PIL Image to Base64
                            buffer = io.BytesIO()
                            pil_image.save(buffer, format="PNG")
                            b64_str = base64.b64encode(buffer.getvalue()).decode("utf-8")
                            
                            img_entity = ExtractedImage(
                                image_id=f"{filename}_p{page_idx}_img{img_idx}",
                                page_number=page_idx,
                                format="png",
                                base64_data=f"data:image/png;base64,{b64_str}",
                                width=round(bbox[2] - bbox[0], 2),
                                height=round(bbox[3] - bbox[1], 2)
                            )
                            extracted_images.append(img_entity)
                            total_images += 1
                    except Exception as e:
                        # Skip corrupted or unparseable inline vector images
                        continue

                # Create chunk if slide contains text OR images
                if cleaned_text or extracted_images:
                    chunk = DocumentChunk(
                        chunk_id=f"{filename}_page_{page_idx}",
                        page_number=page_idx,
                        content=cleaned_text,
                        token_count=len(cleaned_text.split()) if cleaned_text else 0,
                        has_images=len(extracted_images) > 0,
                        images=extracted_images
                    )
                    chunks.append(chunk)
                    
        return chunks, total_images