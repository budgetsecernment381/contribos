#!/usr/bin/env bash
set -euo pipefail

PROJECT_ROOT="$(cd "$(dirname "$0")" && pwd)"
cd "$PROJECT_ROOT"

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
BOLD='\033[1m'
NC='\033[0m'

log()  { echo -e "${CYAN}[contribos]${NC} $*"; }
ok()   { echo -e "${GREEN}[contribos]${NC} $*"; }
warn() { echo -e "${YELLOW}[contribos]${NC} $*"; }
err()  { echo -e "${RED}[contribos]${NC} $*"; }

COMPOSE="docker compose"
if ! $COMPOSE version &>/dev/null; then
  COMPOSE="docker-compose"
  if ! command -v docker-compose &>/dev/null; then
    err "Neither 'docker compose' nor 'docker-compose' found. Install Docker Desktop."
    exit 1
  fi
fi

if ! docker info &>/dev/null; then
  err "Docker daemon is not running. Start Docker Desktop first."
  exit 1
fi

# ── .env check ──────────────────────────────────────────────────────
if [ ! -f .env ]; then
  if [ -f .env.example ]; then
    warn ".env not found — copying from .env.example"
    cp .env.example .env
    warn "Edit .env with your API keys before running again."
    exit 1
  else
    err "No .env or .env.example found. Cannot start."
    exit 1
  fi
fi

source_env() {
  set -a
  # shellcheck disable=SC1091
  source .env
  set +a
}
source_env

MISSING=()
[ -z "${GITHUB_CLIENT_ID:-}" ]     && MISSING+=("GITHUB_CLIENT_ID")
[ -z "${GITHUB_CLIENT_SECRET:-}" ] && MISSING+=("GITHUB_CLIENT_SECRET")
[ -z "${JWT_SECRET:-}" ]           && MISSING+=("JWT_SECRET")

HAS_LLM=false
for key in CLAUDE_API_KEY OPENAI_API_KEY GOOGLE_AI_API_KEY PERPLEXITY_API_KEY MISTRAL_API_KEY GROQ_API_KEY DEEPSEEK_API_KEY XAI_API_KEY; do
  val="${!key:-}"
  if [ -n "$val" ]; then
    HAS_LLM=true
    break
  fi
done
if [ "$HAS_LLM" = false ]; then
  MISSING+=("At least one LLM key (CLAUDE_API_KEY, OPENAI_API_KEY, etc.)")
fi

if [ ${#MISSING[@]} -gt 0 ]; then
  err "Missing required env vars:"
  for m in "${MISSING[@]}"; do
    echo "  - $m"
  done
  err "Edit .env and re-run."
  exit 1
fi

# ── Action parsing ──────────────────────────────────────────────────
ACTION="${1:-up}"

case "$ACTION" in
  up|start)
    log "Building images (this may take a few minutes on first run)..."
    $COMPOSE build --parallel 2>&1 | tail -5

    log "Starting all services..."
    $COMPOSE up -d

    log "Waiting for health checks..."
    SERVICES=(postgres redis api worker web)
    for svc in "${SERVICES[@]}"; do
      printf "  %-10s " "$svc"
      TRIES=0
      MAX=60
      while [ $TRIES -lt $MAX ]; do
        STATE=$($COMPOSE ps --format '{{.Health}}' "$svc" 2>/dev/null || echo "unknown")
        case "$STATE" in
          healthy|"")
            if [ "$svc" = "web" ] || [ "$svc" = "worker" ]; then
              RUNNING=$($COMPOSE ps --format '{{.State}}' "$svc" 2>/dev/null || echo "")
              if [ "$RUNNING" = "running" ]; then
                echo -e "${GREEN}running${NC}"
                break
              fi
            else
              echo -e "${GREEN}healthy${NC}"
              break
            fi
            ;;
        esac
        TRIES=$((TRIES + 1))
        sleep 1
      done
      if [ $TRIES -ge $MAX ]; then
        echo -e "${RED}timeout${NC}"
        warn "Service $svc did not become healthy in ${MAX}s. Check: $COMPOSE logs $svc"
      fi
    done

    echo ""
    ok "ContribOS is running!"
    echo ""
    echo -e "  ${BOLD}Web UI${NC}       http://localhost:3000"
    echo -e "  ${BOLD}API${NC}          http://localhost:3001/api/v1/health"
    echo -e "  ${BOLD}Worker${NC}       http://localhost:8000/health"
    echo -e "  ${BOLD}PostgreSQL${NC}   localhost:5433  (user: contribos)"
    echo -e "  ${BOLD}Redis${NC}        localhost:6380"
    echo ""
    echo -e "  ${CYAN}Logs:${NC}        $COMPOSE logs -f"
    echo -e "  ${CYAN}Stop:${NC}        ./start.sh stop"
    echo -e "  ${CYAN}Restart:${NC}     ./start.sh restart"
    echo -e "  ${CYAN}Rebuild:${NC}     ./start.sh rebuild"
    echo -e "  ${CYAN}Status:${NC}      ./start.sh status"
    echo -e "  ${CYAN}Nuke:${NC}        ./start.sh nuke  (removes volumes + data)"
    echo ""
    ;;

  stop|down)
    log "Stopping all services..."
    $COMPOSE down
    ok "Stopped."
    ;;

  restart)
    log "Restarting all services..."
    $COMPOSE down
    $COMPOSE up -d
    ok "Restarted. UI at http://localhost:3000"
    ;;

  rebuild)
    log "Rebuilding images and restarting..."
    $COMPOSE down
    $COMPOSE build --parallel --no-cache 2>&1 | tail -10
    $COMPOSE up -d
    ok "Rebuilt and started. UI at http://localhost:3000"
    ;;

  status)
    echo ""
    $COMPOSE ps
    echo ""
    log "Service health:"
    for svc in postgres redis api worker web; do
      HEALTH=$($COMPOSE ps --format '{{.Health}}' "$svc" 2>/dev/null || echo "n/a")
      STATE=$($COMPOSE ps --format '{{.State}}' "$svc" 2>/dev/null || echo "n/a")
      if [ "$HEALTH" = "healthy" ] || { [ "$STATE" = "running" ] && [ -z "$HEALTH" ]; }; then
        echo -e "  ${GREEN}●${NC} $svc"
      elif [ "$STATE" = "running" ]; then
        echo -e "  ${YELLOW}●${NC} $svc (starting)"
      else
        echo -e "  ${RED}●${NC} $svc ($STATE)"
      fi
    done
    echo ""
    ;;

  logs)
    shift
    $COMPOSE logs -f "$@"
    ;;

  nuke)
    warn "This will delete ALL data (database, redis, images)."
    read -rp "Type 'yes' to confirm: " CONFIRM
    if [ "$CONFIRM" = "yes" ]; then
      $COMPOSE down -v --rmi local
      ok "Everything nuked."
    else
      log "Cancelled."
    fi
    ;;

  *)
    echo "Usage: ./start.sh [command]"
    echo ""
    echo "Commands:"
    echo "  up|start    Build and start all services (default)"
    echo "  stop|down   Stop all services"
    echo "  restart     Stop then start"
    echo "  rebuild     Full rebuild (no cache) then start"
    echo "  status      Show service status"
    echo "  logs [svc]  Tail logs (optionally for a specific service)"
    echo "  nuke        Remove everything including data volumes"
    exit 1
    ;;
esac
