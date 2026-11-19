import numpy as np
from collections import defaultdict
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

            # Merge slide page references from all synonymous concepts
            merged_slides = sorted(list(set(
                slide_num 
                for idx in cluster_indices 
                for slide_num in (getattr(concepts[idx], 'source_slides', []) or [])
            )))
            canonical_concept.source_slides = merged_slides if merged_slides else [1]
                
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

        # 5. Enforce DAG Acyclicity via Teaching-Order Cycle Breaking
        dag_relationships = self.break_prerequisite_cycles(normalized_concepts, remapped_relationships)

        # 6. Generate Comparative Analytics
        metrics = {
            "raw_concept_count": len(concepts),
            "normalized_concept_count": len(normalized_concepts),
            "concepts_reduced": len(concepts) - len(normalized_concepts),
            "raw_relationship_count": len(relationships),
            "normalized_relationship_count": len(dag_relationships),
            "merged_clusters": merged_clusters
        }

        return normalized_concepts, dag_relationships, metrics

    def break_prerequisite_cycles(
        self, concepts: List[ExtractedConcept], relationships: List[PrerequisiteRelation]
    ) -> List[PrerequisiteRelation]:
        """Removes cycle-forming back-edges using slide introduction order."""
        first_slide = {
            c.concept_id: min(c.source_slides) if getattr(c, "source_slides", None) else 999
            for c in concepts
        }

        # Sort edges so forward teaching-order edges (earlier slide -> later slide) are kept first
        sorted_rels = sorted(
            relationships,
            key=lambda r: (
                first_slide.get(r.source_concept_id, 999) > first_slide.get(r.target_concept_id, 999),
                first_slide.get(r.source_concept_id, 999),
            ),
        )

        adj = defaultdict(list)
        dag_relationships = []

        def creates_cycle(src: str, dst: str) -> bool:
            visited = set()
            stack = [dst]
            while stack:
                node = stack.pop()
                if node == src:
                    return True
                if node not in visited:
                    visited.add(node)
                    stack.extend(adj[node])
            return False

        for rel in sorted_rels:
            if not creates_cycle(rel.source_concept_id, rel.target_concept_id):
                adj[rel.source_concept_id].append(rel.target_concept_id)
                dag_relationships.append(rel)

        return dag_relationships