import os
from neo4j import GraphDatabase
from typing import List, Dict, Any
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

    def verify_dag_acyclicity(self) -> Dict[str, Any]:
        """Runs Cypher cycle check to ensure graph is a Directed Acyclic Graph (DAG)."""
        query = """
        MATCH (n:Concept)
        WHERE (n)-[:PREREQUISITE_OF*1..]->(n)
        RETURN count(n) AS cycle_count
        """
        with self.driver.session() as session:
            result = session.run(query).single()
            cycle_count = result["cycle_count"] if result else 0
            return {"is_dag": cycle_count == 0, "cycle_count": cycle_count}