import numpy as np
from collections import defaultdict
from typing import List, Dict, Any, Optional, Tuple
from sklearn.metrics.pairwise import cosine_similarity
from sentence_transformers import SentenceTransformer
from app.models.schemas import ExtractedConcept, PrerequisiteRelation


class ConceptNormalizer:
    def __init__(self, model_name: str = "all-MiniLM-L6-v2", similarity_threshold: float = 0.82):
        self.model = SentenceTransformer(model_name)
        self.similarity_threshold = similarity_threshold

    def break_prerequisite_cycles(
        self,
        concepts: List[ExtractedConcept],
        relationships: List[PrerequisiteRelation],
    ) -> List[PrerequisiteRelation]:
        """Enforces DAG acyclicity by removing back-edges that violate slide progression or lowest confidence."""
        slide_rank: Dict[str, int] = {}
        for c in concepts:
            slides = getattr(c, "source_slides", None) or [9999]
            slide_rank[c.concept_id] = min(slides)

        active_edges = list(relationships)

        while True:
            adj: Dict[str, List[PrerequisiteRelation]] = defaultdict(list)
            for rel in active_edges:
                adj[rel.source_concept_id].append(rel)

            visited: set = set()
            in_stack: set = set()
            cycle_path: List[PrerequisiteRelation] = []

            def dfs(node: str, path: List[PrerequisiteRelation]) -> bool:
                visited.add(node)
                in_stack.add(node)
                for edge in adj.get(node, []):
                    nxt = edge.target_concept_id
                    if nxt in in_stack:
                        # Extract the exact cycle slice
                        idx = next(
                            (i for i, e in enumerate(path) if e.source_concept_id == nxt),
                            0,
                        )
                        cycle_path.extend(path[idx:] + [edge])
                        return True
                    if nxt not in visited:
                        if dfs(nxt, path + [edge]):
                            return True
                in_stack.remove(node)
                return False

            found_cycle = False
            for node_id in list(adj.keys()):
                if node_id not in visited:
                    if dfs(node_id, []):
                        found_cycle = True
                        break

            if not found_cycle or not cycle_path:
                break

            # Choose weakest edge to prune: prefer edges pointing backward in slide order, then lowest confidence
            weakest_edge = min(
                cycle_path,
                key=lambda e: (
                    0 if slide_rank.get(e.source_concept_id, 0) > slide_rank.get(e.target_concept_id, 0) else 1,
                    getattr(e, "confidence_score", 0.5),
                ),
            )
            active_edges = [
                e for e in active_edges
                if not (
                    e.source_concept_id == weakest_edge.source_concept_id
                    and e.target_concept_id == weakest_edge.target_concept_id
                )
            ]

        return active_edges

    def normalize_graph(
        self,
        concepts: List[ExtractedConcept],
        relationships: List[PrerequisiteRelation],
        existing_concepts: Optional[List[Dict[str, Any]]] = None,
    ) -> Tuple[List[ExtractedConcept], List[PrerequisiteRelation], Dict[str, Any]]:
        if not concepts:
            return [], [], {
                "raw_concept_count": 0,
                "normalized_concept_count": 0,
                "concepts_reduced": 0,
                "raw_relationship_count": 0,
                "normalized_relationship_count": 0,
                "cycles_broken_count": 0,
                "cross_lecture_bridges_count": 0,
                "merged_clusters": [],
            }

        existing_concepts = existing_concepts or []
        canonical_map: Dict[str, str] = {}
        normalized_concepts: List[ExtractedConcept] = []
        merged_clusters: List[Dict[str, Any]] = []
        cross_lecture_bridges = 0

        existing_names = [ec["name"] for ec in existing_concepts]
        existing_embeddings = self.model.encode(existing_names) if existing_names else None

        concept_names = [c.name for c in concepts]
        embeddings = self.model.encode(concept_names)
        sim_matrix = cosine_similarity(embeddings)

        visited = set()

        for i, concept in enumerate(concepts):
            if i in visited:
                continue

            visited.add(i)
            cluster_indices = [i]

            for j in range(i + 1, len(concepts)):
                if j not in visited and sim_matrix[i][j] >= self.similarity_threshold:
                    visited.add(j)
                    cluster_indices.append(j)

            canonical_concept = concepts[i]
            synonyms = [concepts[idx].name for idx in cluster_indices if idx != i]

            merged_slides = sorted(list(set(
                slide_num
                for idx in cluster_indices
                for slide_num in (getattr(concepts[idx], "source_slides", None) or [])
            )))
            canonical_concept.source_slides = merged_slides if merged_slides else [1]

            # Match against already-persisted concepts from earlier lectures in the course
            matched_existing = None
            if existing_embeddings is not None and len(existing_concepts) > 0:
                cross_sims = cosine_similarity([embeddings[i]], existing_embeddings)[0]
                best_idx = int(np.argmax(cross_sims))
                if cross_sims[best_idx] >= self.similarity_threshold:
                    matched_existing = existing_concepts[best_idx]

            if matched_existing:
                target_canonical_id = matched_existing["concept_id"]
                target_canonical_name = matched_existing["name"]
                all_synonyms = list(dict.fromkeys([canonical_concept.name] + synonyms))

                for idx in cluster_indices:
                    canonical_map[concepts[idx].concept_id] = target_canonical_id

                canonical_concept.concept_id = target_canonical_id
                canonical_concept.name = target_canonical_name
                normalized_concepts.append(canonical_concept)
                cross_lecture_bridges += 1

                merged_clusters.append({
                    "canonical_id": target_canonical_id,
                    "canonical_name": f"{target_canonical_name} (Cross-Lecture Bridge)",
                    "is_cross_lecture": True,
                    "synonyms": all_synonyms,
                })
            else:
                for idx in cluster_indices:
                    canonical_map[concepts[idx].concept_id] = canonical_concept.concept_id

                normalized_concepts.append(canonical_concept)

                if synonyms:
                    merged_clusters.append({
                        "canonical_id": canonical_concept.concept_id,
                        "canonical_name": canonical_concept.name,
                        "is_cross_lecture": False,
                        "synonyms": synonyms,
                    })

        # Remap edges onto canonical IDs and deduplicate
        remapped_relationships: List[PrerequisiteRelation] = []
        seen_edges = set()

        for rel in relationships:
            new_source = canonical_map.get(rel.source_concept_id, rel.source_concept_id)
            new_target = canonical_map.get(rel.target_concept_id, rel.target_concept_id)

            if new_source != new_target and (new_source, new_target) not in seen_edges:
                seen_edges.add((new_source, new_target))
                remapped_relationships.append(
                    PrerequisiteRelation(
                        source_concept_id=new_source,
                        target_concept_id=new_target,
                        confidence_score=rel.confidence_score,
                        reasoning=rel.reasoning,
                    )
                )

        raw_remapped_count = len(remapped_relationships)
        dag_relationships = self.break_prerequisite_cycles(normalized_concepts, remapped_relationships)
        cycles_broken = raw_remapped_count - len(dag_relationships)

        metrics = {
            "raw_concept_count": len(concepts),
            "normalized_concept_count": len(normalized_concepts),
            "concepts_reduced": len(concepts) - len(normalized_concepts),
            "raw_relationship_count": len(relationships),
            "normalized_relationship_count": len(dag_relationships),
            "cycles_broken_count": cycles_broken,
            "cross_lecture_bridges_count": cross_lecture_bridges,
            "merged_clusters": merged_clusters,
        }

        return normalized_concepts, dag_relationships, metrics