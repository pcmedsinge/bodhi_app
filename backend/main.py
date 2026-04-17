from contextlib import asynccontextmanager

from fastapi import FastAPI, Depends
from fastapi.middleware.cors import CORSMiddleware
from neo4j import Session

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
def list_conditions(limit: int = 20, session: Session = Depends(get_session)):
    result = session.run(
        "MATCH (c:Condition) RETURN c.snomed_id AS snomed_id, c.name AS name, c.triage_level AS triage_level ORDER BY c.name LIMIT $limit",
        limit=limit,
    )
    return [dict(row) for row in result]


@app.get("/conditions/{snomed_id}/symptoms", tags=["Clinical"])
def condition_symptoms(snomed_id: str, session: Session = Depends(get_session)):
    result = session.run(
        "MATCH (s:Symptom)-[:PRESENT_IN]->(c:Condition {snomed_id: $snomed_id}) RETURN s.name AS symptom, s.triage_level AS triage_level",
        snomed_id=snomed_id,
    )
    return [dict(row) for row in result]
