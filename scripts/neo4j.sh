#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CONTAINER_NAME="neo4j-bodhi"
IMAGE="neo4j:5"
NEO4J_USER="neo4j"
NEO4J_PASSWORD="${NEO4J_PASSWORD:-bodhi123}"
HTTP_PORT="${NEO4J_HTTP_PORT:-7474}"
BOLT_PORT="${NEO4J_BOLT_PORT:-7687}"

DATA_DIR="$ROOT_DIR/neo4j/data"
LOGS_DIR="$ROOT_DIR/neo4j/logs"
PLUGINS_DIR="$ROOT_DIR/neo4j/plugins"
IMPORT_DIR="$ROOT_DIR/neo4j/import"

ensure_dirs() {
  mkdir -p "$DATA_DIR" "$LOGS_DIR" "$PLUGINS_DIR" "$IMPORT_DIR"
}

sync_import_scripts() {
  if [[ -d "$ROOT_DIR/BODHI/bodhi-s/neo4j" ]]; then
    cp -f "$ROOT_DIR/BODHI/bodhi-s/neo4j"/* "$IMPORT_DIR"/ 2>/dev/null || true
  fi
  if [[ -d "$ROOT_DIR/BODHI/bodhi-m/neo4j" ]]; then
    cp -f "$ROOT_DIR/BODHI/bodhi-m/neo4j"/* "$IMPORT_DIR"/ 2>/dev/null || true
  fi
}

container_exists() {
  docker ps -a --format '{{.Names}}' | grep -qx "$CONTAINER_NAME"
}

wait_ready() {
  local max_tries=90
  local i=1
  while [[ $i -le $max_tries ]]; do
    if docker logs "$CONTAINER_NAME" 2>&1 | grep -q "Started."; then
      echo "Neo4j is ready."
      return 0
    fi
    sleep 2
    i=$((i + 1))
  done

  echo "Neo4j did not report ready state in time. Showing recent logs..."
  docker logs --tail 100 "$CONTAINER_NAME" || true
  return 1
}

print_access_info() {
  cat <<EOF
Access URLs:
  Neo4j Browser: http://localhost:$HTTP_PORT/browser/
  Bolt URI: bolt://localhost:$BOLT_PORT
  Username: $NEO4J_USER
EOF
}

up() {
  ensure_dirs
  sync_import_scripts

  if container_exists; then
    if docker ps --format '{{.Names}}' | grep -qx "$CONTAINER_NAME"; then
      echo "Container '$CONTAINER_NAME' is already running."
      print_access_info
      return 0
    fi
    docker start "$CONTAINER_NAME" >/dev/null
    wait_ready
    print_access_info
    return 0
  fi

  docker run -d \
    --name "$CONTAINER_NAME" \
    -p "$HTTP_PORT":7474 \
    -p "$BOLT_PORT":7687 \
    -e "NEO4J_AUTH=${NEO4J_USER}/${NEO4J_PASSWORD}" \
    -e 'NEO4J_PLUGINS=["apoc"]' \
    -v "$DATA_DIR:/data" \
    -v "$LOGS_DIR:/logs" \
    -v "$PLUGINS_DIR:/plugins" \
    -v "$IMPORT_DIR:/import" \
    "$IMAGE" >/dev/null

  wait_ready
  print_access_info
}

down() {
  if container_exists; then
    docker stop "$CONTAINER_NAME" >/dev/null
    echo "Stopped '$CONTAINER_NAME'. Data remains in $DATA_DIR."
  else
    echo "Container '$CONTAINER_NAME' does not exist."
  fi
}

restart() {
  down || true
  up
}

status() {
  docker ps -a --filter "name=$CONTAINER_NAME" --format 'name={{.Names}} status={{.Status}} ports={{.Ports}}'
  if docker ps --format '{{.Names}}' | grep -qx "$CONTAINER_NAME"; then
    print_access_info
  fi
}

logs() {
  docker logs -f "$CONTAINER_NAME"
}

shell() {
  docker exec -it "$CONTAINER_NAME" cypher-shell -u "$NEO4J_USER" -p "$NEO4J_PASSWORD"
}

query() {
  local q="${1:-RETURN 1 AS ok;}"
  docker exec "$CONTAINER_NAME" cypher-shell -u "$NEO4J_USER" -p "$NEO4J_PASSWORD" "$q"
}

reset_data() {
  if docker ps --format '{{.Names}}' | grep -qx "$CONTAINER_NAME"; then
    echo "Stop the container first: ./scripts/neo4j.sh down"
    exit 1
  fi

  if container_exists; then
    docker rm "$CONTAINER_NAME" >/dev/null
  fi

  rm -rf "$DATA_DIR"/*
  echo "Cleared Neo4j data at $DATA_DIR"
}

usage() {
  cat <<EOF
Usage: ./scripts/neo4j.sh <command>

Commands:
  up            Start Neo4j (or create it if missing)
  down          Stop Neo4j container (data persists)
  restart       Restart Neo4j container
  status        Show container status and ports
  logs          Stream container logs
  shell         Open cypher-shell inside container
  query [CYPHER]  Run one Cypher query (default: RETURN 1 AS ok;)
  reset-data    Remove container and clear persisted database files

Default access:
  Browser: http://localhost:7474/browser/
  Bolt URI: bolt://localhost:7687
EOF
}

cmd="${1:-}"
case "$cmd" in
  up) up ;;
  down) down ;;
  restart) restart ;;
  status) status ;;
  logs) logs ;;
  shell) shell ;;
  query) shift || true; query "${1:-RETURN 1 AS ok;}" ;;
  reset-data) reset_data ;;
  *) usage ;;
esac
