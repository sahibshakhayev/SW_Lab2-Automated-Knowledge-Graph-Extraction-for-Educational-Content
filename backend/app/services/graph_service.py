import os
import json
import re
import uuid
from datetime import datetime, timezone
from collections import defaultdict, deque
from typing import List, Dict, Any, Optional
from neo4j import GraphDatabase


def _slugify(text: str) -> str:
    slug = re.sub(r"[^a-z0-9]+", "_", text.lower()).strip("_")
    return slug or f"concept_{uuid.uuid4().hex[:6]}"


class GraphService:
    def __init__(
        self,
        uri: Optional[str] = None,
        user: Optional[str] = None,
        password: Optional[str] = None,
    ):
        neo4j_uri = uri or os.getenv("NEO4J_URI", "bolt://neo4j:7687")
        neo4j_user = user or os.getenv("NEO4J_USER", "neo4j")
        neo4j_password = password or os.getenv("NEO4J_PASSWORD", "password")

        self.driver = GraphDatabase.driver(neo4j_uri, auth=(neo4j_user, neo4j_password))
        self._ensure_constraints()

    def close(self):
        self.driver.close()

    def run_query(self, query: str, params: Optional[Dict[str, Any]] = None) -> List[Dict[str, Any]]:
        with self.driver.session() as session:
            result = session.run(query, params or {})
            return [record.data() for record in result]

    def init_constraints(self):
        self._ensure_constraints()

    def _ensure_constraints(self):
        # Drop legacy single-graph uniqueness constraint on Concept.id (replaced by Concept.uid)
        legacy = self.run_query(
            """
            SHOW CONSTRAINTS YIELD name, labelsOrTypes, properties
            WHERE 'Concept' IN labelsOrTypes AND properties = ['id']
            RETURN name
            """
        )
        for row in legacy:
            self.run_query(f"DROP CONSTRAINT `{row['name']}` IF EXISTS")

        # Remove orphaned pre-course Concept nodes lacking a composite uid
        self.run_query("MATCH (n:Concept) WHERE n.uid IS NULL DETACH DELETE n")

        # Enforce multi-course uniqueness constraints
        self.run_query("CREATE CONSTRAINT IF NOT EXISTS FOR (c:Course) REQUIRE c.id IS UNIQUE")
        self.run_query("CREATE CONSTRAINT IF NOT EXISTS FOR (n:Concept) REQUIRE n.uid IS UNIQUE")
        
    @staticmethod
    def _uid(course_id: str, concept_id: str) -> str:
        return f"{course_id}::{concept_id}"

    # ------------------------------------------------------------------
    # 1. Multi-Course Management (Create, List, Get, Update, Delete)
    # ------------------------------------------------------------------
    def create_course(self, code: str, title: str, description: str = "") -> Dict[str, Any]:
        course_id = f"course_{uuid.uuid4().hex[:8]}"
        now = datetime.now(timezone.utc).isoformat()
        query = """
        CREATE (c:Course {
            id: $id,
            code: $code,
            title: $title,
            description: $description,
            lectures: [],
            baseline_raw_nodes: 0,
            baseline_raw_edges: 0,
            baseline_auto_nodes: 0,
            baseline_auto_edges: 0,
            manual_edits_count: 0,
            is_verified: false,
            accuracy_rating: 5,
            completeness_rating: 5,
            pedagogical_clarity_rating: 5,
            lecturer_notes: '',
            created_at: $now,
            updated_at: $now
        })
        RETURN c {.*} AS course
        """
        rows = self.run_query(query, {"id": course_id, "code": code, "title": title, "description": description, "now": now})
        return rows[0]["course"]

    def list_courses(self) -> List[Dict[str, Any]]:
        query = """
        MATCH (c:Course)
        OPTIONAL MATCH (c)-[:HAS_CONCEPT]->(n:Concept)
        OPTIONAL MATCH (n)-[r:PREREQUISITE_OF]->(:Concept)
        WITH c, count(DISTINCT n) AS node_count, count(DISTINCT r) AS edge_count
        RETURN c {
            .*,
            node_count: node_count,
            edge_count: edge_count
        } AS course
        ORDER BY c.updated_at DESC
        """
        rows = self.run_query(query)
        if not rows:
            default = self.create_course("COURSE-101", "Default Course Knowledge Graph", "Initial course workspace")
            default["node_count"] = 0
            default["edge_count"] = 0
            return [default]
        return [r["course"] for r in rows]

    
    def update_course(self, course_id: str, code: Optional[str], title: Optional[str], description: Optional[str]) -> Dict[str, Any]:
        now = datetime.now(timezone.utc).isoformat()
        query = """
        MATCH (c:Course {id: $course_id})
        SET c.code = coalesce($code, c.code),
            c.title = coalesce($title, c.title),
            c.description = coalesce($description, c.description),
            c.updated_at = $now
        RETURN c {.*} AS course
        """
        rows = self.run_query(query, {"course_id": course_id, "code": code, "title": title, "description": description, "now": now})
        if not rows:
            raise ValueError(f"Course '{course_id}' not found.")
        return rows[0]["course"]

    def delete_course(self, course_id: str) -> None:
        query = """
        MATCH (c:Course {id: $course_id})
        OPTIONAL MATCH (c)-[:HAS_CONCEPT]->(n:Concept)
        DETACH DELETE n, c
        """
        self.run_query(query, {"course_id": course_id})

    def clear_course_graph(self, course_id: str) -> None:
        now = datetime.now(timezone.utc).isoformat()
        query = """
        MATCH (c:Course {id: $course_id})
        OPTIONAL MATCH (c)-[:HAS_CONCEPT]->(n:Concept)
        DETACH DELETE n
        SET c.lectures = [],
            c.baseline_raw_nodes = 0,
            c.baseline_raw_edges = 0,
            c.baseline_auto_nodes = 0,
            c.baseline_auto_edges = 0,
            c.manual_edits_count = 0,
            c.is_verified = false,
            c.updated_at = $now
        """
        self.run_query(query, {"course_id": course_id, "now": now})

    def _touch_course_edit(self, course_id: str, increment_edit: bool = True):
        now = datetime.now(timezone.utc).isoformat()
        inc = 1 if increment_edit else 0
        self.run_query(
            """
            MATCH (c:Course {id: $course_id})
            SET c.manual_edits_count = coalesce(c.manual_edits_count, 0) + $inc,
                c.updated_at = $now
            """,
            {"course_id": course_id, "inc": inc, "now": now},
        )

    # ------------------------------------------------------------------
    # 2. Course-Wide Graph Persistence & Retrieval
    # ------------------------------------------------------------------
    def get_existing_concepts(self, course_id: str) -> List[Dict[str, Any]]:
        query = """
        MATCH (:Course {id: $course_id})-[:HAS_CONCEPT]->(n:Concept)
        RETURN n.id AS concept_id,
               n.name AS name,
               n.description AS description,
               coalesce(n.source_slides, [1]) AS source_slides,
               coalesce(n.source_files, []) AS source_files
        """
        return self.run_query(query, {"course_id": course_id})

    def persist_course_extraction(
        self,
        course_id: str,
        filename: str,
        raw_concepts: List[Any],
        raw_relationships: List[Any],
        concepts: List[Any],
        relationships: List[Any],
        analytics: Dict[str, Any],
        append_mode: bool,
    ) -> Dict[str, Any]:
        now = datetime.now(timezone.utc).isoformat()

        # Load prior snapshots if appending lectures to a course-wide graph
        existing_course = self.run_query(
            "MATCH (c:Course {id: $cid}) RETURN c.raw_snapshot_json AS raw_j, c.auto_snapshot_json AS auto_j",
            {"cid": course_id},
        )[0]

        raw_snap = json.loads(existing_course["raw_j"]) if (append_mode and existing_course.get("raw_j")) else {"nodes": [], "edges": []}
        auto_snap = json.loads(existing_course["auto_j"]) if (append_mode and existing_course.get("auto_j")) else {"nodes": [], "edges": []}

        raw_nodes_set = set(raw_snap["nodes"]) | {c.concept_id for c in raw_concepts}
        raw_edges_set = set(tuple(e) for e in raw_snap["edges"]) | {
            (r.source_concept_id, r.target_concept_id) for r in raw_relationships
        }

        auto_nodes_set = set(auto_snap["nodes"]) | {c.concept_id for c in concepts}
        auto_edges_set = set(tuple(e) for e in auto_snap["edges"]) | {
            (r.source_concept_id, r.target_concept_id) for r in relationships
        }

        # Upsert normalized concepts into Neo4j
        for c in concepts:
            uid = self._uid(course_id, c.concept_id)
            slides = getattr(c, "source_slides", None) or [1]
            self.run_query(
                """
                MATCH (course:Course {id: $course_id})
                MERGE (n:Concept {uid: $uid})
                ON CREATE SET
                    n.id = $cid,
                    n.course_id = $course_id,
                    n.name = $name,
                    n.description = $desc,
                    n.domain = $domain,
                    n.source_slides = $slides,
                    n.source_files = [$filename]
                ON MATCH SET
                    n.description = CASE WHEN size(n.description) < size($desc) THEN $desc ELSE n.description END,
                    n.source_slides = [x IN (coalesce(n.source_slides, []) + $slides) | x],
                    n.source_files = CASE
                        WHEN $filename IN coalesce(n.source_files, []) THEN n.source_files
                        ELSE coalesce(n.source_files, []) + [$filename]
                    END
                MERGE (course)-[:HAS_CONCEPT]->(n)
                """,
                {
                    "course_id": course_id,
                    "uid": uid,
                    "cid": c.concept_id,
                    "name": c.name,
                    "desc": c.description or "",
                    "domain": getattr(c, "domain", None) or "General",
                    "slides": slides,
                    "filename": filename,
                },
            )

        for rel in relationships:
            src_uid = self._uid(course_id, rel.source_concept_id)
            tgt_uid = self._uid(course_id, rel.target_concept_id)
            self.run_query(
                """
                MATCH (a:Concept {uid: $src_uid}), (b:Concept {uid: $tgt_uid})
                MERGE (a)-[r:PREREQUISITE_OF]->(b)
                ON CREATE SET
                    r.confidence = $conf,
                    r.reasoning = $reasoning,
                    r.curated_by_lecturer = false
                """,
                {
                    "src_uid": src_uid,
                    "tgt_uid": tgt_uid,
                    "conf": getattr(rel, "confidence_score", 0.9),
                    "reasoning": getattr(rel, "reasoning", ""),
                },
            )

        self.run_query(
            """
            MATCH (c:Course {id: $course_id})
            SET c.lectures = CASE
                    WHEN $filename IN coalesce(c.lectures, []) THEN c.lectures
                    ELSE coalesce(c.lectures, []) + [$filename]
                END,
                c.raw_snapshot_json = $raw_json,
                c.auto_snapshot_json = $auto_json,
                c.baseline_raw_nodes = $raw_n,
                c.baseline_raw_edges = $raw_e,
                c.baseline_auto_nodes = $norm_n,
                c.baseline_auto_edges = $norm_e,
                c.is_verified = false,
                c.updated_at = $now
            """,
            {
                "course_id": course_id,
                "filename": filename,
                "raw_json": json.dumps({"nodes": sorted(raw_nodes_set), "edges": [list(e) for e in sorted(raw_edges_set)]}),
                "auto_json": json.dumps({"nodes": sorted(auto_nodes_set), "edges": [list(e) for e in sorted(auto_edges_set)]}),
                "raw_n": len(raw_nodes_set),
                "raw_e": len(raw_edges_set),
                "norm_n": len(auto_nodes_set),
                "norm_e": len(auto_edges_set),
                "now": now,
            },
        )
        return self.get_course_graph(course_id)

    @staticmethod
    def _prf1(pred_set: set, gold_set: set) -> Dict[str, float]:
        tp = len(pred_set & gold_set)
        prec = tp / len(pred_set) if pred_set else 0.0
        rec = tp / len(gold_set) if gold_set else 0.0
        f1 = (2 * prec * rec / (prec + rec)) if (prec + rec) > 0 else 0.0
        return {
            "precision": round(prec * 100, 1),
            "recall": round(rec * 100, 1),
            "f1": round(f1 * 100, 1),
        }

    def compute_ablation_benchmark(self, course_id: str) -> Dict[str, Any]:
        """Computes Precision, Recall, F1, Compression, and Graph Edit Distance vs. Lecturer Gold Standard."""
        graph_data = self.get_course_graph(course_id)
        course = graph_data["course"]

        gold_nodes = {c["concept_id"] for c in graph_data["concepts"]}
        gold_edges = {(r["source_concept_id"], r["target_concept_id"]) for r in graph_data["relationships"]}

        raw_snap = json.loads(course["raw_snapshot_json"]) if course.get("raw_snapshot_json") else {"nodes": list(gold_nodes), "edges": [list(e) for e in gold_edges]}
        auto_snap = json.loads(course["auto_snapshot_json"]) if course.get("auto_snapshot_json") else {"nodes": list(gold_nodes), "edges": [list(e) for e in gold_edges]}

        raw_nodes = set(raw_snap["nodes"])
        raw_edges = {tuple(e) for e in raw_snap["edges"]}
        auto_nodes = set(auto_snap["nodes"])
        auto_edges = {tuple(e) for e in auto_snap["edges"]}

        compression_pct = round(((len(raw_nodes) - len(auto_nodes)) / len(raw_nodes) * 100), 1) if raw_nodes else 0.0

        return {
            "course_id": course_id,
            "course_code": course.get("code"),
            "course_title": course.get("title"),
            "lectures": course.get("lectures", []),
            "is_verified_gold_standard": course.get("is_verified", False),
            "counts": {
                "raw_nodes": len(raw_nodes),
                "auto_nodes": len(auto_nodes),
                "gold_nodes": len(gold_nodes),
                "raw_edges": len(raw_edges),
                "auto_edges": len(auto_edges),
                "gold_edges": len(gold_edges),
                "node_compression_pct": compression_pct,
            },
            "stage1_raw_vs_gold": {
                "concepts": self._prf1(raw_nodes, gold_nodes),
                "edges": self._prf1(raw_edges, gold_edges),
                "graph_edit_distance": len(raw_nodes ^ gold_nodes) + len(raw_edges ^ gold_edges),
            },
            "stage2_normalized_vs_gold": {
                "concepts": self._prf1(auto_nodes, gold_nodes),
                "edges": self._prf1(auto_edges, gold_edges),
                "graph_edit_distance": len(auto_nodes ^ gold_nodes) + len(auto_edges ^ gold_edges),
            },
        }

    def get_course_graph(self, course_id: str) -> Dict[str, Any]:
        course_rows = self.run_query("MATCH (c:Course {id: $course_id}) RETURN c {.*} AS course", {"course_id": course_id})
        if not course_rows:
            raise ValueError(f"Course '{course_id}' not found.")

        concepts = self.run_query(
            """
            MATCH (:Course {id: $course_id})-[:HAS_CONCEPT]->(n:Concept)
            RETURN n.id AS concept_id,
                   n.name AS name,
                   coalesce(n.description, '') AS description,
                   coalesce(n.domain, 'General') AS domain,
                   coalesce(n.source_slides, [1]) AS source_slides,
                   coalesce(n.source_files, []) AS source_files
            ORDER BY n.name ASC
            """,
            {"course_id": course_id},
        )

        relationships = self.run_query(
            """
            MATCH (:Course {id: $course_id})-[:HAS_CONCEPT]->(a:Concept)-[r:PREREQUISITE_OF]->(b:Concept)<-[:HAS_CONCEPT]-(:Course {id: $course_id})
            RETURN a.id AS source_concept_id,
                   b.id AS target_concept_id,
                   coalesce(r.reasoning, '') AS reasoning,
                   coalesce(r.curated_by_lecturer, false) AS curated_by_lecturer
            """,
            {"course_id": course_id},
        )

        return {
            "course": course_rows[0]["course"],
            "concepts": concepts,
            "relationships": relationships,
            "topology_check": self.verify_dag_acyclicity(course_id),
        }

    # ------------------------------------------------------------------
    # 3. Full Lecturer Curation (Add/Edit/Delete/Merge Nodes & Edges)
    # ------------------------------------------------------------------
    def create_concept(
        self, course_id: str, name: str, description: str, domain: str, source_slides: List[int], source_file: str
    ) -> Dict[str, Any]:
        base_slug = _slugify(name)
        concept_id = base_slug
        uid = self._uid(course_id, concept_id)

        # Ensure unique ID within the course
        if self.run_query("MATCH (n:Concept {uid: $uid}) RETURN n", {"uid": uid}):
            concept_id = f"{base_slug}_{uuid.uuid4().hex[:4]}"
            uid = self._uid(course_id, concept_id)

        rows = self.run_query(
            """
            MATCH (c:Course {id: $course_id})
            CREATE (n:Concept {
                uid: $uid,
                id: $cid,
                course_id: $course_id,
                name: $name,
                description: $desc,
                domain: $domain,
                source_slides: $slides,
                source_files: [$source_file]
            })
            CREATE (c)-[:HAS_CONCEPT]->(n)
            RETURN n.id AS concept_id, n.name AS name, n.description AS description,
                   n.domain AS domain, n.source_slides AS source_slides, n.source_files AS source_files
            """,
            {
                "course_id": course_id,
                "uid": uid,
                "cid": concept_id,
                "name": name,
                "desc": description,
                "domain": domain,
                "slides": sorted(list(set(source_slides or [1]))),
                "source_file": source_file,
            },
        )
        self._touch_course_edit(course_id, increment_edit=True)
        return rows[0]

    def update_concept(
        self, course_id: str, concept_id: str, name: str, description: str, domain: str, source_slides: List[int]
    ) -> Dict[str, Any]:
        uid = self._uid(course_id, concept_id)
        rows = self.run_query(
            """
            MATCH (n:Concept {uid: $uid})
            SET n.name = $name,
                n.description = $desc,
                n.domain = $domain,
                n.source_slides = $slides
            RETURN n.id AS concept_id, n.name AS name, n.description AS description,
                   n.domain AS domain, n.source_slides AS source_slides, n.source_files AS source_files
            """,
            {
                "uid": uid,
                "name": name,
                "desc": description,
                "domain": domain,
                "slides": sorted(list(set(source_slides or [1]))),
            },
        )
        if not rows:
            raise ValueError(f"Concept '{concept_id}' not found in course.")
        self._touch_course_edit(course_id, increment_edit=True)
        return rows[0]

    def delete_concept(self, course_id: str, concept_id: str) -> None:
        uid = self._uid(course_id, concept_id)
        self.run_query("MATCH (n:Concept {uid: $uid}) DETACH DELETE n", {"uid": uid})
        self._touch_course_edit(course_id, increment_edit=True)

    def merge_concepts(self, course_id: str, source_id: str, target_id: str) -> None:
        if source_id == target_id:
            raise ValueError("Cannot merge a concept into itself.")
        src_uid = self._uid(course_id, source_id)
        tgt_uid = self._uid(course_id, target_id)

        # Redirect incoming edges to target
        self.run_query(
            """
            MATCH (other:Concept)-[r:PREREQUISITE_OF]->(src:Concept {uid: $src_uid})
            MATCH (tgt:Concept {uid: $tgt_uid})
            WHERE other.uid <> tgt.uid
            MERGE (other)-[nr:PREREQUISITE_OF]->(tgt)
            ON CREATE SET nr.reasoning = r.reasoning, nr.confidence = r.confidence, nr.curated_by_lecturer = true
            DELETE r
            """,
            {"src_uid": src_uid, "tgt_uid": tgt_uid},
        )

        # Redirect outgoing edges from target
        self.run_query(
            """
            MATCH (src:Concept {uid: $src_uid})-[r:PREREQUISITE_OF]->(other:Concept)
            MATCH (tgt:Concept {uid: $tgt_uid})
            WHERE other.uid <> tgt.uid
            MERGE (tgt)-[nr:PREREQUISITE_OF]->(other)
            ON CREATE SET nr.reasoning = r.reasoning, nr.confidence = r.confidence, nr.curated_by_lecturer = true
            DELETE r
            """,
            {"src_uid": src_uid, "tgt_uid": tgt_uid},
        )

        # Merge slides/files metadata and delete duplicate source node
        self.run_query(
            """
            MATCH (src:Concept {uid: $src_uid}), (tgt:Concept {uid: $tgt_uid})
            SET tgt.source_slides = coalesce(tgt.source_slides, []) + coalesce(src.source_slides, []),
                tgt.source_files = coalesce(tgt.source_files, []) + coalesce(src.source_files, [])
            DETACH DELETE src
            """,
            {"src_uid": src_uid, "tgt_uid": tgt_uid},
        )
        self._touch_course_edit(course_id, increment_edit=True)

    def create_edge(self, course_id: str, source_id: str, target_id: str, reasoning: str) -> Dict[str, Any]:
        if source_id == target_id:
            raise ValueError("Self-loop prerequisite edges are not permitted.")
        src_uid = self._uid(course_id, source_id)
        tgt_uid = self._uid(course_id, target_id)
        rows = self.run_query(
            """
            MATCH (a:Concept {uid: $src_uid}), (b:Concept {uid: $tgt_uid})
            MERGE (a)-[r:PREREQUISITE_OF]->(b)
            SET r.reasoning = $reasoning,
                r.confidence = 1.0,
                r.curated_by_lecturer = true
            RETURN a.id AS source_concept_id, b.id AS target_concept_id,
                   r.reasoning AS reasoning, r.curated_by_lecturer AS curated_by_lecturer
            """,
            {"src_uid": src_uid, "tgt_uid": tgt_uid, "reasoning": reasoning},
        )
        if not rows:
            raise ValueError("Source or target concept does not exist in this course.")
        self._touch_course_edit(course_id, increment_edit=True)
        return rows[0]

    def update_edge(
        self, course_id: str, source_id: str, target_id: str, reasoning: str, reverse_direction: bool = False
    ) -> Dict[str, Any]:
        src_uid = self._uid(course_id, source_id)
        tgt_uid = self._uid(course_id, target_id)

        if reverse_direction:
            self.run_query(
                "MATCH (a:Concept {uid: $src_uid})-[r:PREREQUISITE_OF]->(b:Concept {uid: $tgt_uid}) DELETE r",
                {"src_uid": src_uid, "tgt_uid": tgt_uid},
            )
            return self.create_edge(course_id, target_id, source_id, reasoning)

        rows = self.run_query(
            """
            MATCH (a:Concept {uid: $src_uid})-[r:PREREQUISITE_OF]->(b:Concept {uid: $tgt_uid})
            SET r.reasoning = $reasoning,
                r.curated_by_lecturer = true
            RETURN a.id AS source_concept_id, b.id AS target_concept_id,
                   r.reasoning AS reasoning, r.curated_by_lecturer AS curated_by_lecturer
            """,
            {"src_uid": src_uid, "tgt_uid": tgt_uid, "reasoning": reasoning},
        )
        if not rows:
            raise ValueError("Prerequisite edge not found.")
        self._touch_course_edit(course_id, increment_edit=True)
        return rows[0]

    def delete_edge(self, course_id: str, source_id: str, target_id: str) -> None:
        src_uid = self._uid(course_id, source_id)
        tgt_uid = self._uid(course_id, target_id)
        self.run_query(
            "MATCH (a:Concept {uid: $src_uid})-[r:PREREQUISITE_OF]->(b:Concept {uid: $tgt_uid}) DELETE r",
            {"src_uid": src_uid, "tgt_uid": tgt_uid},
        )
        self._touch_course_edit(course_id, increment_edit=True)

    # ------------------------------------------------------------------
    # 4. Topology Verification & Lecturer Evaluation Metrics
    # ------------------------------------------------------------------
    def verify_dag_acyclicity(self, course_id: str) -> Dict[str, Any]:
        query = """
        MATCH path = (c:Concept {course_id: $course_id})-[:PREREQUISITE_OF*1..6]->(c)
        WITH [n IN nodes(path)[0..-1] | n.id] AS cycle_nodes,
             [r IN relationships(path) | {source: startNode(r).id, target: endNode(r).id}] AS edges
        RETURN cycle_nodes, edges
        LIMIT 25
        """
        rows = self.run_query(query, {"course_id": course_id})
        seen_cycles = set()
        unique_edges = []

        for row in rows:
            nodes = row["cycle_nodes"]
            if not nodes:
                continue
            min_idx = nodes.index(min(nodes))
            canonical = tuple(nodes[min_idx:] + nodes[:min_idx])
            if canonical not in seen_cycles:
                seen_cycles.add(canonical)
                unique_edges.extend(row["edges"])

        return {
            "is_dag": len(seen_cycles) == 0,
            "cycle_count": len(seen_cycles),
            "cycle_edges": unique_edges,
        }

    def save_lecturer_evaluation(
        self,
        course_id: str,
        is_verified: bool,
        accuracy_rating: int,
        completeness_rating: int,
        pedagogical_clarity_rating: int,
        lecturer_notes: str,
    ) -> Dict[str, Any]:
        now = datetime.now(timezone.utc).isoformat()
        self.run_query(
            """
            MATCH (c:Course {id: $course_id})
            SET c.is_verified = $is_verified,
                c.accuracy_rating = $acc,
                c.completeness_rating = $comp,
                c.pedagogical_clarity_rating = $clarity,
                c.lecturer_notes = $notes,
                c.updated_at = $now
            """,
            {
                "course_id": course_id,
                "is_verified": is_verified,
                "acc": accuracy_rating,
                "comp": completeness_rating,
                "clarity": pedagogical_clarity_rating,
                "notes": lecturer_notes,
                "now": now,
            },
        )
        return self.get_course_evaluation(course_id)

    def get_course_evaluation(self, course_id: str) -> Dict[str, Any]:
        graph_data = self.get_course_graph(course_id)
        course = graph_data["course"]
        nodes = graph_data["concepts"]
        edges = graph_data["relationships"]
        dag_status = graph_data["topology_check"]

        n = len(nodes)
        e = len(edges)
        density = round(e / (n * (n - 1)), 4) if n > 1 else 0.0
        lecturer_curated_edges = sum(1 for edge in edges if edge.get("curated_by_lecturer"))

        # Compute DAG depth and root/leaf nodes
        adj = defaultdict(list)
        in_deg = {node["concept_id"]: 0 for node in nodes}
        out_deg = {node["concept_id"]: 0 for node in nodes}
        for edge in edges:
            s, t = edge["source_concept_id"], edge["target_concept_id"]
            if s in in_deg and t in in_deg:
                adj[s].append(t)
                in_deg[t] += 1
                out_deg[s] += 1

        roots = [nid for nid, d in in_deg.items() if d == 0]
        leaves = [nid for nid, d in out_deg.items() if d == 0]

        dist = {nid: 0 for nid in in_deg}
        q = deque(roots)
        while q:
            curr = q.popleft()
            for nxt in adj[curr]:
                dist[nxt] = max(dist[nxt], dist[curr] + 1)
                in_deg[nxt] -= 1
                if in_deg[nxt] == 0:
                    q.append(nxt)

        auto_edges = course.get("baseline_auto_edges", e)
        auto_nodes = course.get("baseline_auto_nodes", n)
        manual_edits = course.get("manual_edits_count", 0)
        denom = max(auto_nodes + auto_edges, 1)
        pipeline_alignment = round(max(0.0, (1.0 - (manual_edits / denom)) * 100), 1)

        return {
            "course_id": course_id,
            "course_code": course.get("code"),
            "course_title": course.get("title"),
            "lectures_included": course.get("lectures", []),
            "is_verified": course.get("is_verified", False),
            "baseline_vs_curated": {
                "raw_llm_nodes": course.get("baseline_raw_nodes", n),
                "auto_normalized_nodes": auto_nodes,
                "final_curated_nodes": n,
                "raw_llm_edges": course.get("baseline_raw_edges", e),
                "auto_normalized_edges": auto_edges,
                "final_curated_edges": e,
                "lecturer_curated_edges": lecturer_curated_edges,
                "manual_edits_count": manual_edits,
                "pipeline_alignment_pct": pipeline_alignment,
            },
            "topology_metrics": {
                "graph_density": density,
                "foundational_roots": len(roots),
                "advanced_leaves": len(leaves),
                "longest_prerequisite_chain": max(dist.values()) if dist else 0,
                "is_valid_dag": dag_status["is_dag"],
                "remaining_cycles": dag_status["cycle_count"],
            },
            "lecturer_rubric": {
                "accuracy_rating": course.get("accuracy_rating", 5),
                "completeness_rating": course.get("completeness_rating", 5),
                "pedagogical_clarity_rating": course.get("pedagogical_clarity_rating", 5),
                "lecturer_notes": course.get("lecturer_notes", ""),
                "updated_at": course.get("updated_at"),
            },
        }