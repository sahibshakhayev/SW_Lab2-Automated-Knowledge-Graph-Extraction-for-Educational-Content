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