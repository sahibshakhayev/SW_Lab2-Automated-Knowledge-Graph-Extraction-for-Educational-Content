import numpy as np
from typing import List, Dict, Tuple
from sentence_transformers import SentenceTransformer
from sklearn.metrics.pairwise import cosine_similarity
from app.schemas.graph import ExtractedConcept, PrerequisiteRelation

class ConceptNormalizer:
    def __init__(self, model_name: str = "sentence-transformers/all-MiniLM-L6-v2", threshold: float = 0.82):
        # Using a fast, local embedding model to avoid API costs
        self.model = SentenceTransformer(model_name)
        self.similarity_threshold = threshold

    def normalize_graph(self, concepts: List[ExtractedConcept], relationships: List[PrerequisiteRelation]):
        if not concepts:
            return [], [], {}

        # 1. Generate Embeddings for concept names
        concept_names = [c.name for c in concepts]
        embeddings = self.model.encode(concept_names)
        
        # 2. Calculate Cosine Similarity Adjacency Matrix
        sim_matrix = cosine_similarity(embeddings)
        
        visited = set()
        canonical_map: Dict[str, str] = {}  # Maps old_id -> canonical_id
        normalized_concepts: List[ExtractedConcept] = []
        merged_clusters = []

        # 3. Cluster Synonymous Nodes
        for i, concept in enumerate(concepts):
            if i in visited:
                continue
            
            visited.add(i)
            cluster_indices = [i]
            
            # Find semantic matches exceeding the threshold
            for j in range(i + 1, len(concepts)):
                if j not in visited and sim_matrix[i][j] >= self.similarity_threshold:
                    visited.add(j)
                    cluster_indices.append(j)
            
            # The first node becomes the Canonical Entity
            canonical_concept = concepts[i]
            synonyms = [concepts[idx].name for idx in cluster_indices if idx != i]
            
            for idx in cluster_indices:
                canonical_map[concepts[idx].concept_id] = canonical_concept.concept_id
                
            normalized_concepts.append(canonical_concept)
            
            if synonyms:
                merged_clusters.append({
                    "canonical_id": canonical_concept.concept_id,
                    "canonical_name": canonical_concept.name,
                    "synonyms": synonyms
                })

        # 4. Remap and Deduplicate Prerequisite Edges
        remapped_relationships = []
        seen_edges = set()

        for rel in relationships:
            new_source = canonical_map.get(rel.source_concept_id, rel.source_concept_id)
            new_target = canonical_map.get(rel.target_concept_id, rel.target_concept_id)

            # Drop self-referential loops caused by merging two concepts
            if new_source != new_target and (new_source, new_target) not in seen_edges:
                seen_edges.add((new_source, new_target))
                remapped_relationships.append(
                    PrerequisiteRelation(
                        source_concept_id=new_source,
                        target_concept_id=new_target,
                        confidence_score=rel.confidence_score,
                        reasoning=rel.reasoning
                    )
                )

        # 5. Generate Week 4 Comparative Analytics
        metrics = {
            "raw_concept_count": len(concepts),
            "normalized_concept_count": len(normalized_concepts),
            "concepts_reduced": len(concepts) - len(normalized_concepts),
            "raw_relationship_count": len(relationships),
            "normalized_relationship_count": len(remapped_relationships),
            "merged_clusters": merged_clusters
        }

        return normalized_concepts, remapped_relationships, metrics