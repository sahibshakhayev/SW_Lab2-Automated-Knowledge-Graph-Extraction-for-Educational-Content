import os
from neo4j import GraphDatabase
from collections import deque, defaultdict

from typing import List, Dict, Any, Optional
from app.schemas.graph import ExtractedConcept, PrerequisiteRelation

class GraphService:
    def __init__(self):
        uri = os.getenv("NEO4J_URI", "bolt://neo4j:7687")
        user = os.getenv("NEO4J_USER", "neo4j")
        password = os.getenv("NEO4J_PASSWORD", "password123")
        self.driver = GraphDatabase.driver(uri, auth=(user, password))

    def close(self):
        self.driver.close()

    def init_constraints(self):
        """Creates uniqueness constraints on Concept nodes."""
        query = """
        CREATE CONSTRAINT concept_id_unique IF NOT EXISTS
        FOR (c:Concept) REQUIRE c.id IS UNIQUE
        """
        with self.driver.session() as session:
            session.run(query)
    
    def run_query(self, query: str, parameters: dict = None):
        """Executes a custom Cypher query against the Neo4j instance."""
        if not self.driver:
            return None
        with self.driver.session() as session:
            result = session.run(query, parameters or {})
            return [record.data() for record in result]
        
    def verify_dag_acyclicity(self):
        """Checks Neo4j for cyclic prerequisite loops and returns cycle paths."""
        query = """
        MATCH path = (c:Concept)-[:PREREQUISITE_OF*1..5]->(c)
        RETURN [node IN nodes(path) | node.id] AS cycle_path
        LIMIT 10
        """
        results = self.run_query(query) or []
        cycle_paths = [r["cycle_path"] for r in results]
        
        # Build set of cycle edge tuples (source -> target)
        cycle_edges = []
        for path in cycle_paths:
            for i in range(len(path) - 1):
                cycle_edges.append({"source": path[i], "target": path[i+1]})

        return {
            "is_dag": len(cycle_paths) == 0,
            "cycle_count": len(cycle_paths),
            "cycles": cycle_paths,
            "cycle_edges": cycle_edges
        }

    def unmerge_concept(self, canonical_id: str, target_synonym_name: str):
        """Detaches a synonym from a canonical entity and re-creates it as a standalone node."""
        new_id = target_synonym_name.lower().replace(" ", "_").replace("-", "_")
        query = """
        MERGE (c:Concept {id: $new_id})
        SET c.name = $name, 
            c.description = $desc, 
            c.domain = 'Computer Science', 
            c.unmerged = true
        RETURN c
        """
        params = {
            "new_id": new_id,
            "name": target_synonym_name,
            "desc": f"Manually unmerged concept split from {canonical_id}."
        }
        return self.run_query(query, params)

    def persist_graph(self, concepts: List[ExtractedConcept], relationships: List[PrerequisiteRelation]) -> Dict[str, int]:
        """Atomically merges concepts and prerequisite edges into Neo4j."""
        concepts_created = 0
        relations_created = 0

        with self.driver.session() as session:
            # 1. Merge Concepts
            for concept in concepts:
                query = """
                MERGE (c:Concept {id: $id})
                ON CREATE SET c.name = $name, c.description = $description, c.domain = $domain
                ON MATCH SET c.name = $name, c.description = $description
                """
                session.run(
                    query, 
                    id=concept.concept_id, 
                    name=concept.name, 
                    description=concept.description, 
                    domain=concept.domain
                )
                concepts_created += 1

            # 2. Merge Prerequisite Relationships
            for rel in relationships:
                query = """
                MATCH (source:Concept {id: $source_id})
                MATCH (target:Concept {id: $target_id})
                MERGE (source)-[r:PREREQUISITE_OF]->(target)
                ON CREATE SET r.confidence = $confidence, r.reasoning = $reasoning
                """
                session.run(
                    query, 
                    source_id=rel.source_concept_id, 
                    target_id=rel.target_concept_id,
                    confidence=rel.confidence_score, 
                    reasoning=rel.reasoning
                )
                relations_created += 1

        return {"concepts_persisted": concepts_created, "relationships_persisted": relations_created}

    def clear_graph(self):
        """Clears all Concept nodes and relationships for a fresh single-lecture demo."""
        self.run_query("MATCH (n:Concept) DETACH DELETE n")

    def verify_dag_acyclicity(self, concept_ids: Optional[List[str]] = None):
        """Finds unique simple prerequisite cycles without duplicate node rotations."""
        where_clause = "WHERE ALL(n IN nodes(path) WHERE n.id IN $ids)" if concept_ids else ""
        query = f"""
        MATCH path = (c:Concept)-[:PREREQUISITE_OF*1..5]->(c)
        {where_clause}
        RETURN [node IN nodes(path) | node.id] AS cycle_path
        """
        results = self.run_query(query, {"ids": concept_ids} if concept_ids else None) or []

        unique_cycles = {}
        cycle_edges_set = set()

        for r in results:
            path = r["cycle_path"]
            core_nodes = path[:-1]  # Exclude repeated closing node
            if not core_nodes:
                continue
            # Canonicalize cycle rotation starting from lexicographically smallest node ID
            min_idx = core_nodes.index(min(core_nodes))
            canonical = tuple(core_nodes[min_idx:] + core_nodes[:min_idx])
            unique_cycles[canonical] = list(canonical) + [canonical[0]]

            for i in range(len(path) - 1):
                cycle_edges_set.add((path[i], path[i + 1]))

        return {
            "is_dag": len(unique_cycles) == 0,
            "cycle_count": len(unique_cycles),
            "cycles": list(unique_cycles.values()),
            "cycle_edges": [{"source": s, "target": t} for s, t in cycle_edges_set],
        }

    from collections import deque, defaultdict
    from typing import Optional, Dict, Any, List

    def get_learning_path(self, target_concept_id: Optional[str] = None) -> Dict[str, Any]:
        """Computes a topologically sorted learning path using Kahn's Algorithm."""
        nodes_res = self.run_query("MATCH (c:Concept) RETURN c.id AS id, c.name AS name, c.description AS description") or []
        edges_res = self.run_query("MATCH (a:Concept)-[:PREREQUISITE_OF]->(b:Concept) RETURN a.id AS source, b.id AS target") or []

        if not nodes_res:
            return {"is_valid_dag": True, "sequence": [], "highlighted_node_ids": [], "highlighted_edges": []}

        node_map = {n["id"]: n for n in nodes_res}
        adj: Dict[str, List[str]] = defaultdict(list)
        rev_adj: Dict[str, List[str]] = defaultdict(list)
        in_degree: Dict[str, int] = {n["id"]: 0 for n in nodes_res}

        for edge in edges_res:
            src, tgt = edge["source"], edge["target"]
            if src in node_map and tgt in node_map:
                adj[src].append(tgt)
                rev_adj[tgt].append(src)
                in_degree[tgt] += 1

        # If target_concept_id is specified, isolate its upstream prerequisite subgraph via reverse BFS
        relevant_nodes = set(node_map.keys())
        highlighted_edges = []
        if target_concept_id and target_concept_id in node_map:
            relevant_nodes = {target_concept_id}
            queue = deque([target_concept_id])
            while queue:
                curr = queue.popleft()
                for prereq in rev_adj[curr]:
                    highlighted_edges.append({"source": prereq, "target": curr})
                    if prereq not in relevant_nodes:
                        relevant_nodes.add(prereq)
                        queue.append(prereq)

            # Recompute in-degrees restricted to the target subgraph
            in_degree = {nid: 0 for nid in relevant_nodes}
            for nid in relevant_nodes:
                for nxt in adj[nid]:
                    if nxt in relevant_nodes:
                        in_degree[nxt] += 1

        # Kahn's Algorithm for topological ordering
        zero_in_queue = deque([nid for nid, deg in in_degree.items() if deg == 0])
        sorted_sequence = []

        while zero_in_queue:
            curr_id = zero_in_queue.popleft()
            sorted_sequence.append(node_map[curr_id])
            for neighbor in adj[curr_id]:
                if neighbor in relevant_nodes:
                    in_degree[neighbor] -= 1
                    if in_degree[neighbor] == 0:
                        zero_in_queue.append(neighbor)

        return {
            "is_valid_dag": len(sorted_sequence) == len(relevant_nodes),
            "target_concept_id": target_concept_id,
            "sequence": sorted_sequence,
            "highlighted_node_ids": list(relevant_nodes),
            "highlighted_edges": highlighted_edges
        }