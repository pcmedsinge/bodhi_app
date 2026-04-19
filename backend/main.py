from contextlib import asynccontextmanager

from fastapi import Depends, FastAPI, HTTPException, Path, Query
from fastapi.middleware.cors import CORSMiddleware
from neo4j import Session
from pydantic import BaseModel, Field

from db import get_session, close_driver


@asynccontextmanager
async def lifespan(app: FastAPI):
    yield
    close_driver()


app = FastAPI(
    title="BODHI API",
    description="Bharat Ontology for Disease and Healthcare Informatics",
    version="0.1.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://localhost:3000"],
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/health", tags=["System"])
def health():
    return {"status": "ok"}


def fetch_condition_summary(session: Session, snomed_id: str):
    return session.run(
        """
        MATCH (c:Condition {snomed_id: $snomed_id})
        OPTIONAL MATCH (k:Concept {snomed_id: c.snomed_id})
        RETURN c.snomed_id AS snomed_id,
               c.name AS name,
               c.triage_level AS triage_level,
               c.overall_likelihood AS overall_likelihood,
               c.type_condition AS type_condition,
               c.concept_type AS concept_type,
               k.name AS matched_concept_name,
               k.display_name AS matched_concept_display_name,
               k.level_concept AS matched_concept_level
        """,
        snomed_id=snomed_id,
    ).single()


def format_node(node):
    labels = list(node.labels)
    properties = dict(node)

    return {
        "id": node.element_id,
        "label": labels[0] if labels else "Node",
        "name": properties.get("name") or properties.get("display_name") or properties.get("loinc_id") or properties.get("id"),
        "properties": properties,
    }


def format_relationship(relationship):
    properties = dict(relationship)

    return {
        "id": relationship.element_id,
        "type": relationship.type,
        "source": relationship.start_node.element_id,
        "target": relationship.end_node.element_id,
        "properties": properties,
    }


class SymptomCheckRequest(BaseModel):
    symptoms: list[str] = Field(min_length=1, max_length=20)
    top_k: int = Field(default=10, ge=1, le=30)


def triage_weight(triage_level: str | None) -> float:
    if triage_level is None:
        return 1.0

    normalized = triage_level.lower()
    if normalized in {"emergency", "red_flag"}:
        return 1.35
    if normalized in {"worrisome"}:
        return 1.2
    if normalized in {"opd_managed", "opd-managed"}:
        return 1.0
    return 1.0


def confidence_bucket(score: float) -> str:
    if score >= 70:
        return "high"
    if score >= 45:
        return "medium"
    return "low"


@app.get("/graph/stats", tags=["Graph"])
def graph_stats(session: Session = Depends(get_session)):
    node_result = session.run("MATCH (n) RETURN labels(n)[0] AS label, count(n) AS count ORDER BY label")
    nodes = {row["label"]: row["count"] for row in node_result}

    rel_result = session.run("MATCH ()-[r]->() RETURN type(r) AS type, count(r) AS count ORDER BY type")
    relationships = {row["type"]: row["count"] for row in rel_result}

    return {
        "nodes": nodes,
        "relationships": relationships,
        "total_nodes": sum(nodes.values()),
        "total_relationships": sum(relationships.values()),
    }


@app.get("/conditions", tags=["Clinical"])
def list_conditions(
    limit: int = Query(default=20, ge=1, le=200),
    offset: int = Query(default=0, ge=0),
    q: str | None = Query(default=None, max_length=100),
    speciality: str | None = Query(default=None, max_length=100),
    session: Session = Depends(get_session),
):
    result = session.run(
        """
        MATCH (c:Condition)
        WHERE ($q IS NULL OR toLower(c.name) CONTAINS toLower($q))
          AND (
            $speciality IS NULL
            OR EXISTS {
              MATCH (c)-[:TREATED_BY]->(sp:Speciality)
              WHERE toLower(sp.name) = toLower($speciality)
            }
          )
        RETURN c.snomed_id AS snomed_id,
               c.name AS name,
               c.triage_level AS triage_level
        ORDER BY c.name
        SKIP $offset
        LIMIT $limit
        """,
        limit=limit,
        offset=offset,
        q=q,
        speciality=speciality,
    )
    return [dict(row) for row in result]


@app.get("/conditions/{snomed_id}", tags=["Clinical"])
def condition_detail(snomed_id: str = Path(max_length=20), session: Session = Depends(get_session)):
    summary = fetch_condition_summary(session, snomed_id)

    if summary is None:
        raise HTTPException(status_code=404, detail="Condition not found")

    symptoms = session.run(
        """
        MATCH (s:Symptom)-[r:PRESENT_IN]->(c:Condition {snomed_id: $snomed_id})
        RETURN s.name AS name,
               s.triage_level AS triage_level,
               r.relation_type AS relation_type
        ORDER BY s.name
        """,
        snomed_id=snomed_id,
    )

    specialties = session.run(
        """
        MATCH (c:Condition {snomed_id: $snomed_id})-[:TREATED_BY]->(sp:Speciality)
        RETURN DISTINCT sp.id AS id,
               sp.name AS name
        ORDER BY sp.name
        """,
        snomed_id=snomed_id,
    )

    drugs = session.run(
        """
        MATCH (c:Condition {snomed_id: $snomed_id})
        MATCH (base:Concept {snomed_id: c.snomed_id})
        MATCH path = (base)-[:CHILD_OF*0..4]->(concept:Concept)-[:TREATED_BY]->(d:Drug)
        WITH d, collect(DISTINCT concept.name) AS source_concepts, min(length(path)) AS hops
        RETURN d.hash AS id,
               d.name AS name,
               source_concepts[0] AS source_concept,
               hops
        ORDER BY hops, name
        """,
        snomed_id=snomed_id,
    )

    labs = session.run(
        """
        MATCH (c:Condition {snomed_id: $snomed_id})
        MATCH (base:Concept {snomed_id: c.snomed_id})
        MATCH path = (base)-[:CHILD_OF*0..4]->(concept:Concept)
        WITH concept, min(length(path)) AS hops
        CALL {
          WITH concept
          MATCH (concept)-[:MONITORED_BY]->(l:LabInvestigation)
          RETURN l
          UNION
          WITH concept
          MATCH (concept)<-[:IMPACTS]-(l:LabInvestigation)
          RETURN l
        }
        RETURN DISTINCT l.loinc_id AS loinc_id,
               l.display_name AS name,
               l.system_map AS system_map,
               l.impact_problem AS impact_problem,
               concept.name AS source_concept,
               hops
        ORDER BY hops, name
        """,
        snomed_id=snomed_id,
    )

    prerequisites = session.run(
        """
        MATCH (c:Condition {snomed_id: $snomed_id})-[:HAS_PREREQUISITE]-(related:Condition)
        RETURN DISTINCT related.snomed_id AS snomed_id,
               related.name AS name,
               related.triage_level AS triage_level
        ORDER BY related.name
        """,
        snomed_id=snomed_id,
    )

    influenced_by = session.run(
        """
        MATCH (c:Condition {snomed_id: $snomed_id})-[:IS_INFLUENCED_BY]-(related:Condition)
        RETURN DISTINCT related.snomed_id AS snomed_id,
               related.name AS name,
               related.triage_level AS triage_level
        ORDER BY related.name
        LIMIT 20
        """,
        snomed_id=snomed_id,
    )

    return {
        "condition": dict(summary),
        "symptoms": [dict(row) for row in symptoms],
        "specialties": [dict(row) for row in specialties],
        "drugs": [dict(row) for row in drugs],
        "labs": [dict(row) for row in labs],
        "prerequisites": [dict(row) for row in prerequisites],
        "related_conditions": [dict(row) for row in influenced_by],
    }


@app.get("/conditions/{snomed_id}/symptoms", tags=["Clinical"])
def condition_symptoms(snomed_id: str = Path(max_length=20), session: Session = Depends(get_session)):
    summary = fetch_condition_summary(session, snomed_id)

    if summary is None:
        raise HTTPException(status_code=404, detail="Condition not found")

    result = session.run(
        """
        MATCH (s:Symptom)-[r:PRESENT_IN]->(c:Condition {snomed_id: $snomed_id})
        RETURN s.name AS symptom,
               s.triage_level AS triage_level,
               r.relation_type AS relation_type
        ORDER BY s.name
        """,
        snomed_id=snomed_id,
    )
    return [dict(row) for row in result]


@app.get("/symptoms", tags=["Clinical"])
def list_symptoms(
    limit: int = Query(default=50, ge=1, le=200),
    offset: int = Query(default=0, ge=0),
    q: str | None = Query(default=None, max_length=100),
    session: Session = Depends(get_session),
):
    result = session.run(
        """
        MATCH (s:Symptom)
        WHERE ($q IS NULL OR toLower(s.name) CONTAINS toLower($q))
        RETURN DISTINCT s.name AS name,
               s.triage_level AS triage_level,
               s.root_snomed_id AS root_snomed_id,
               s.root_snomed_name AS root_snomed_name
        ORDER BY s.name
        SKIP $offset
        LIMIT $limit
        """,
        limit=limit,
        offset=offset,
        q=q,
    )
    return [dict(row) for row in result]


@app.post("/symptom-check", tags=["Clinical"])
def symptom_check(payload: SymptomCheckRequest, session: Session = Depends(get_session)):
    normalized_input = []
    seen = set()
    for item in payload.symptoms:
        normalized = item.strip()
        if not normalized:
            continue

        lowered = normalized.lower()
        if lowered in seen:
            continue

        seen.add(lowered)
        normalized_input.append(normalized)

    if not normalized_input:
        raise HTTPException(status_code=400, detail="At least one valid symptom is required")

    result = session.run(
        """
        UNWIND $symptoms AS symptom_name
        MATCH (input:Symptom)
        WHERE toLower(input.name) = toLower(symptom_name)
        WITH symptom_name, input,
             CASE WHEN exists((input)-[:PRESENT_IN]->()) THEN input.name
                  ELSE input.root_snomed_name END AS effective_name
        MATCH (s:Symptom)-[:PRESENT_IN]->(c:Condition)
        WHERE toLower(s.name) = toLower(effective_name)
        WITH c, collect(DISTINCT symptom_name) AS input_names, collect(DISTINCT s.name) AS matched_symptoms, count(DISTINCT s) AS matched_count
        OPTIONAL MATCH (all_sym:Symptom)-[:PRESENT_IN]->(c)
        WITH c, input_names, matched_symptoms, matched_count, count(DISTINCT all_sym) AS total_symptoms
        RETURN c.snomed_id AS snomed_id,
               c.name AS name,
               c.triage_level AS triage_level,
               input_names,
               matched_symptoms,
               matched_count,
               total_symptoms,
               CASE
                 WHEN total_symptoms = 0 THEN 0.0
                 ELSE toFloat(matched_count) / toFloat(total_symptoms)
               END AS match_ratio
        ORDER BY matched_count DESC, match_ratio DESC, c.name
        LIMIT $top_k
        """,
        symptoms=normalized_input,
        top_k=payload.top_k,
    )

    output = []

    for row in result:
        row_data = dict(row)
        matched_symptoms = row_data["matched_symptoms"]
        matched_input_names = {n.lower() for n in row_data["input_names"]}

        weighted_score = (
            (row_data["matched_count"] * 12.0) + (row_data["match_ratio"] * 45.0)
        ) * triage_weight(row_data["triage_level"])
        bounded_score = min(100.0, round(weighted_score, 2))

        output.append(
            {
                "snomed_id": row_data["snomed_id"],
                "name": row_data["name"],
                "triage_level": row_data["triage_level"],
                "matched_count": row_data["matched_count"],
                "total_symptoms": row_data["total_symptoms"],
                "match_ratio": round(row_data["match_ratio"], 3),
                "score": bounded_score,
                "confidence": confidence_bucket(bounded_score),
                "matched_symptoms": matched_symptoms,
                "missing_input_symptoms": [
                    s for s in normalized_input if s.lower() not in matched_input_names
                ],
            }
        )

    return {
        "input_symptoms": normalized_input,
        "result_count": len(output),
        "results": output,
    }


@app.get("/drugs", tags=["Clinical"])
def list_drugs(
    limit: int = Query(default=50, ge=1, le=200),
    offset: int = Query(default=0, ge=0),
    q: str | None = Query(default=None, max_length=100),
    session: Session = Depends(get_session),
):
    result = session.run(
        """
        MATCH (d:Drug)
        WHERE ($q IS NULL OR toLower(d.name) CONTAINS toLower($q))
        RETURN d.hash AS id,
               d.name AS name
        ORDER BY d.name
        SKIP $offset
        LIMIT $limit
        """,
        limit=limit,
        offset=offset,
        q=q,
    )
    return [dict(row) for row in result]


@app.get("/labs", tags=["Clinical"])
def list_labs(
    limit: int = Query(default=50, ge=1, le=200),
    offset: int = Query(default=0, ge=0),
    q: str | None = Query(default=None, max_length=100),
    session: Session = Depends(get_session),
):
    result = session.run(
        """
        MATCH (l:LabInvestigation)
        WHERE ($q IS NULL OR toLower(l.display_name) CONTAINS toLower($q) OR toLower(l.loinc_id) CONTAINS toLower($q))
        RETURN l.loinc_id AS loinc_id,
               l.display_name AS name,
               l.system_map AS system_map,
               l.impact_problem AS impact_problem
        ORDER BY l.display_name
        SKIP $offset
        LIMIT $limit
        """,
        limit=limit,
        offset=offset,
        q=q,
    )
    return [dict(row) for row in result]


@app.get("/specialties", tags=["Clinical"])
def list_specialties(
    limit: int = Query(default=50, ge=1, le=200),
    offset: int = Query(default=0, ge=0),
    q: str | None = Query(default=None, max_length=100),
    session: Session = Depends(get_session),
):
    result = session.run(
        """
        MATCH (sp:Speciality)
        WHERE ($q IS NULL OR toLower(sp.name) CONTAINS toLower($q))
        RETURN sp.id AS id,
               sp.name AS name
        ORDER BY sp.name
        SKIP $offset
        LIMIT $limit
        """,
        limit=limit,
        offset=offset,
        q=q,
    )
    return [dict(row) for row in result]


@app.get("/drugs/{drug_hash}/conditions", tags=["Clinical"])
def drug_conditions(drug_hash: str = Path(max_length=64), session: Session = Depends(get_session)):
    drug_row = session.run(
        "MATCH (d:Drug {hash: $hash}) RETURN d.name AS name",
        hash=drug_hash,
    ).single()

    if drug_row is None:
        raise HTTPException(status_code=404, detail="Drug not found")

    result = session.run(
        """
        MATCH (d:Drug {hash: $hash})<-[:TREATED_BY]-(concept:Concept)
        OPTIONAL MATCH (concept)<-[:CHILD_OF*0..4]-(child:Concept)
        OPTIONAL MATCH (cond:Condition {snomed_id: child.snomed_id})
        WITH d, concept, collect(DISTINCT cond) AS matched_conditions
        UNWIND matched_conditions AS c
        WITH c WHERE c IS NOT NULL
        RETURN DISTINCT c.snomed_id AS snomed_id,
               c.name AS name,
               c.triage_level AS triage_level
        ORDER BY c.name
        """,
        hash=drug_hash,
    )

    return {
        "drug": {"id": drug_hash, "name": drug_row["name"]},
        "conditions": [dict(row) for row in result],
    }


@app.get("/labs/{loinc_id}/conditions", tags=["Clinical"])
def lab_conditions(loinc_id: str = Path(max_length=20), session: Session = Depends(get_session)):
    lab_row = session.run(
        """
        MATCH (l:LabInvestigation {loinc_id: $loinc_id})
        RETURN l.display_name AS name, l.system_map AS system_map
        """,
        loinc_id=loinc_id,
    ).single()

    if lab_row is None:
        raise HTTPException(status_code=404, detail="Lab investigation not found")

    result = session.run(
        """
        MATCH (l:LabInvestigation {loinc_id: $loinc_id})
        OPTIONAL MATCH (l)<-[:MONITORED_BY]-(c1:Concept)
        OPTIONAL MATCH (l)-[:IMPACTS]->(c2:Concept)
        WITH collect(DISTINCT c1) + collect(DISTINCT c2) AS concepts
        UNWIND concepts AS concept
        WITH DISTINCT concept WHERE concept IS NOT NULL
        OPTIONAL MATCH (concept)<-[:CHILD_OF*0..4]-(child:Concept)
        WITH collect(DISTINCT concept) + collect(DISTINCT child) AS all_concepts
        UNWIND all_concepts AS c
        WITH DISTINCT c WHERE c IS NOT NULL
        MATCH (cond:Condition {snomed_id: c.snomed_id})
        RETURN DISTINCT cond.snomed_id AS snomed_id,
               cond.name AS name,
               cond.triage_level AS triage_level
        ORDER BY cond.name
        """,
        loinc_id=loinc_id,
    )

    return {
        "lab": {"loinc_id": loinc_id, "name": lab_row["name"], "system_map": lab_row["system_map"]},
        "conditions": [dict(row) for row in result],
    }


@app.get("/conditions/{snomed_id}/neighborhood", tags=["Graph"])
def condition_neighborhood(
    snomed_id: str = Path(max_length=20),
    depth: int = Query(default=2, ge=1, le=2),
    limit: int = Query(default=25, ge=1, le=100),
    session: Session = Depends(get_session),
):
    summary = fetch_condition_summary(session, snomed_id)

    if summary is None:
        raise HTTPException(status_code=404, detail="Condition not found")

    result = session.run(
        """
        MATCH path = (c:Condition {snomed_id: $snomed_id})-[*1..2]-(neighbor)
        RETURN path
        LIMIT $limit
        """,
        snomed_id=snomed_id,
        limit=limit,
    )

    nodes_by_id = {}
    relationships_by_id = {}

    for record in result:
        path = record["path"]
        if len(path.relationships) > depth:
            continue

        for node in path.nodes:
            nodes_by_id[node.element_id] = format_node(node)

        for relationship in path.relationships:
            relationships_by_id[relationship.element_id] = format_relationship(relationship)

    return {
        "center": dict(summary),
        "depth": depth,
        "nodes": list(nodes_by_id.values()),
        "relationships": list(relationships_by_id.values()),
    }
