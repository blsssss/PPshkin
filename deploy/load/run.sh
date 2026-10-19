#!/bin/sh
set -eu
cd "$(dirname "$0")/../.."
compose() {
  docker compose -f compose.yaml -f deploy/load/compose.load.yaml "$@"
}
psql_stand() {
  compose exec -T db psql -U ppshkin -d ppshkin -v ON_ERROR_STOP=1 -q "$@"
}

psql_stand < deploy/load/seed.sql
status=0
compose run --rm k6 run /load/pilot.js || status=$?
psql_stand < deploy/load/check.sql || status=1
echo "fake MAX calls: $(compose exec -T fake-max wget -qO- http://127.0.0.1:8081/stats)"
exit "$status"
