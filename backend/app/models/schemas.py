from pydantic import BaseModel, Field
from typing import List, Optional


# ------------------------------------------------------------------
# Core LLM Extraction & Normalization Schemas
# ------------------------------------------------------------------
class ExtractedConcept(BaseModel):
    concept_id: str
    name: str
    description: str = Field(default="")
    domain: Optional[str] = Field(default="General")
    source_slides: List[int] = Field(default_factory=lambda: [1])


class PrerequisiteRelation(BaseModel):
    source_concept_id: str
    target_concept_id: str
    confidence_score: float = Field(default=0.9, ge=0.0, le=1.0)
    reasoning: str = Field(default="")


class KnowledgeGraphExtraction(BaseModel):
    concepts: List[ExtractedConcept] = Field(default_factory=list)
    relationships: List[PrerequisiteRelation] = Field(default_factory=list)


# Compatibility aliases in case llm_service imports either name
KnowledgeGraph = KnowledgeGraphExtraction
ExtractedGraph = KnowledgeGraphExtraction


# ------------------------------------------------------------------
# Multi-Course Management Schemas
# ------------------------------------------------------------------
class CourseCreate(BaseModel):
    code: str = Field(..., min_length=1, max_length=32, example="IP-18cAI")
    title: str = Field(..., min_length=1, max_length=120, example="Artificial Intelligence")
    description: Optional[str] = Field(default="", max_length=500)


class CourseUpdate(BaseModel):
    code: Optional[str] = Field(default=None, min_length=1, max_length=32)
    title: Optional[str] = Field(default=None, min_length=1, max_length=120)
    description: Optional[str] = Field(default=None, max_length=500)


# ------------------------------------------------------------------
# Lecturer Graph Curation Schemas (Nodes, Edges & Merges)
# ------------------------------------------------------------------
class ConceptCreateRequest(BaseModel):
    name: str = Field(..., min_length=1, max_length=120)
    description: str = Field(default="")
    domain: Optional[str] = Field(default="General")
    source_slides: List[int] = Field(default_factory=lambda: [1])
    source_file: Optional[str] = Field(default="Lecturer Manual Entry")


class ConceptUpdateRequest(BaseModel):
    name: str = Field(..., min_length=1, max_length=120)
    description: str = Field(default="")
    domain: Optional[str] = Field(default="General")
    source_slides: List[int] = Field(default_factory=lambda: [1])


class ConceptMergeRequest(BaseModel):
    source_concept_id: str = Field(..., description="Duplicate node to merge and remove")
    target_concept_id: str = Field(..., description="Canonical node to retain")


class EdgeCreateRequest(BaseModel):
    source_concept_id: str
    target_concept_id: str
    reasoning: str = Field(default="Added manually by course lecturer.")


class EdgeUpdateRequest(BaseModel):
    source_concept_id: str
    target_concept_id: str
    reasoning: str = Field(default="")
    reverse_direction: bool = Field(default=False)


# ------------------------------------------------------------------
# Lecturer Gold-Standard Evaluation Schema
# ------------------------------------------------------------------
class LecturerEvaluationRequest(BaseModel):
    is_verified: bool = Field(..., description="True when lecturer signs off graph as 100% accurate")
    accuracy_rating: int = Field(..., ge=1, le=5)
    completeness_rating: int = Field(..., ge=1, le=5)
    pedagogical_clarity_rating: int = Field(..., ge=1, le=5)
    lecturer_notes: Optional[str] = Field(default="")