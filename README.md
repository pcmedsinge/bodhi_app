# BODHI — Bharat Ontology for Disease and Healthcare Informatics

A full-stack clinical knowledge graph application built on top of the [BODHI ontology](https://github.com/eka-care/BODHI) by Eka Care.

**Stack:** FastAPI · React (Vite + TypeScript) · Neo4j 5.x · Docker Compose

> Data licensed under [CC BY-NC 4.0](https://creativecommons.org/licenses/by-nc/4.0/) — non-commercial use only. Credit: Eka Care.

---

## Cloning this repo

The BODHI ontology data is included as a **git submodule** (see section below). Always clone with:

```bash
git clone --recurse-submodules https://github.com/pcmedsinge/bodhi_app.git
```

If you already cloned without `--recurse-submodules`, fetch the submodule manually:

```bash
git submodule update --init --recursive
```

---

## Project structure

```
bodhi_app/
├── backend/            # FastAPI app (Neo4j queries, REST endpoints)
│   ├── main.py
│   ├── db.py
│   ├── Dockerfile
│   ├── requirements.txt
│   └── .env.example    # Copy to .env and fill in credentials
├── frontend/           # React + Vite dashboard
│   ├── src/
│   ├── Dockerfile
│   └── vite.config.ts
├── neo4j/
│   ├── import/         # Cypher import scripts (bodhi_s.cypher, bodhi_m.cypher)
│   └── plugins/
├── BODHI/              # Upstream ontology data (git submodule → eka-care/BODHI)
├── scripts/
│   └── neo4j.sh        # Helper to run cypher-shell queries
└── docker-compose.yml
```

---

## Quick start (Docker Compose)

```bash
cp backend/.env.example backend/.env   # set credentials if needed
docker compose up --build
```

| Service  | URL                          |
|----------|------------------------------|
| Frontend | http://localhost:5173        |
| Backend  | http://localhost:8000/docs   |
| Neo4j    | http://localhost:7474        |

On first run, import the ontology data into Neo4j:

```bash
docker exec neo4j-bodhi cypher-shell -u neo4j -p bodhi123 -f /import/bodhi_s.cypher
docker exec neo4j-bodhi cypher-shell -u neo4j -p bodhi123 -f /import/bodhi_m.cypher
```

---

## BODHI submodule — how it works and how to update

### Why a submodule?

The `BODHI/` folder is the upstream ontology source from Eka Care. It is not copied into this repo — instead it is tracked as a **git submodule**. This means:

- Only a pointer (commit hash) to the external repo is stored here, not the actual files.
- The version of the ontology you are using is always explicit and reproducible.
- Updates from upstream are pulled deliberately, not silently.

### Check which version you are on

```bash
git submodule status
# output example:
# a3f82c1 BODHI (heads/main)
# the hash is the exact upstream commit your project is pinned to
```

### Update to the latest upstream version

```bash
cd BODHI
git pull origin main          # pull latest from eka-care/BODHI
cd ..
git add BODHI
git commit -m "chore: update BODHI submodule to latest upstream"
git push
```

### Pin to a specific upstream version (tag or commit)

```bash
cd BODHI
git checkout v2.0.0           # or any commit hash
cd ..
git add BODHI
git commit -m "chore: pin BODHI submodule to v2.0.0"
git push
```

### After pulling this repo when someone else updated the submodule pointer

```bash
git pull
git submodule update --recursive
```

---

## Backend environment variables

Copy `backend/.env.example` to `backend/.env`:

```
NEO4J_URI=bolt://localhost:7687
NEO4J_USER=neo4j
NEO4J_PASSWORD=changeme
```

When running via Docker Compose, these are injected automatically from `docker-compose.yml` and point to the `neo4j` service name instead of `localhost`.

---

## License

Application code: MIT  
BODHI ontology data (`BODHI/`): [CC BY-NC 4.0](https://creativecommons.org/licenses/by-nc/4.0/) — Eka Care
