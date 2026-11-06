from pydantic import BaseModel, Field
from typing import List, Optional

class ExtractedConcept(BaseModel):
    concept_id: str = Field(description="Unique snake_case identifier, e.g., hill_climbing")
    name: str = Field(description="Human-readable concept name")
    description: str = Field(description="Brief definition of the concept")
    domain: Optional[str] = Field(default="Computer Science")
    source_slides: List[int] = Field(default_factory=list, description="List of PDF slide page numbers where concept appears")

class PrerequisiteRelation(BaseModel):
    source_concept_id: str = Field(description="Prerequisite concept required first")
    target_concept_id: str = Field(description="Target concept that depends on the source")
    confidence_score: float = Field(default=1.0, ge=0.0, le=1.0)
    reasoning: Optional[str] = Field(default=None, description="Justification for relationship")

class GraphExtractionResponse(BaseModel):
    concepts: List[ExtractedConcept]
    relationships: List[PrerequisiteRelation]

class UnmergeRequest(BaseModel):
    canonical_id: str
    target_synonym_name: str