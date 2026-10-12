#!/usr/bin/env bash
# Resolves the experiment folder whose committed models evaluate-g1.yml re-scores. Run from the
# repository root. Explicit source, in order: $INPUT_SOURCE (the workflow_dispatch input), then
# .github/eval-source (first non-comment line, committed on the eval/** branch), then the only
# experiments/*-g1*/models folder. Never guessed by name order: more than one candidate without an
# explicit source fails. Appends SRC (models folder) and EXP (output folder) to $GITHUB_ENV.
set -euo pipefail
OUT="${GITHUB_ENV:-/dev/stdout}"

FROM="workflow_dispatch input"
SRC="${INPUT_SOURCE:-}"
if [ -z "$SRC" ] && [ -f .github/eval-source ]; then
  FROM=".github/eval-source"
  SRC=$( (grep -v '^[[:space:]]*\(#\|$\)' .github/eval-source || true) | head -1 | tr -d '[:space:]')
  [ -n "$SRC" ] || { echo "::error::.github/eval-source names no folder"; exit 1; }
fi
if [ -z "$SRC" ]; then
  FROM="sole candidate"
  CANDIDATES=()
  for d in experiments/*-g1*/models; do
    [ -d "$d" ] && CANDIDATES+=("${d%/models}")
  done
  if [ "${#CANDIDATES[@]}" -ne 1 ]; then
    echo "::error::${#CANDIDATES[@]} experiments/*-g1*/models folders and no explicit source; set the 'source' input or commit .github/eval-source naming one of:"
    if [ "${#CANDIDATES[@]}" -gt 0 ]; then printf '  %s\n' "${CANDIDATES[@]}"; fi
    exit 1
  fi
  SRC="${CANDIDATES[0]}"
fi
SRC="${SRC%/}"
SRC="${SRC%/models}"
[[ "$SRC" =~ ^experiments/[A-Za-z0-9][A-Za-z0-9._-]*$ ]] || {
  echo "::error::source '$SRC' ($FROM) is not experiments/<id>"
  exit 1
}
[ -d "$SRC/models" ] || { echo "::error::$SRC/models ($FROM) does not exist"; exit 1; }
echo "source experiment: $SRC (from $FROM)" >&2
echo "SRC=$SRC/models" >>"$OUT"
echo "EXP=$SRC-r2" >>"$OUT"
