#!/usr/bin/env bash
# Per-epoch training checkpoints on a git branch, so a cancelled or crashed CI job resumes instead
# of starting over (GitHub runners are discarded with all local files when a job ends).
#
#   train-checkpoint.sh restore <dir> <branch>   restore <dir> from <branch> if it exists
#   train-checkpoint.sh sync    <dir> <branch>   force-push <dir> as a one-commit orphan <branch>
#   train-checkpoint.sh watch   <dir> <branch>   sync whenever <dir>/manifest.json changes (loop)
#
# Uses the repository in the current directory and its `origin` credentials. The branch holds only
# the training output folder (manifest, checkpoint/, best/, final weights); it is never merged.
set -euo pipefail

cmd=${1:?usage: train-checkpoint.sh restore|sync|watch <dir> <branch>}
dir=${2:?missing dir}
branch=${3:?missing branch}

case "$cmd" in
  restore)
    mkdir -p "$dir"
    if git fetch -q origin "refs/heads/$branch" 2>/dev/null; then
      git archive FETCH_HEAD | tar -x -C "$dir"
      echo "restored $dir from $branch ($(git rev-parse --short FETCH_HEAD))"
    else
      echo "no checkpoint branch $branch: starting fresh"
    fi
    ;;
  sync)
    [ -f "$dir/manifest.json" ] || exit 0
    tmpd=$(mktemp -d)
    export GIT_INDEX_FILE="$tmpd/index"
    git --work-tree="$dir" add -A .
    tree=$(git write-tree)
    commit=$(git -c user.name="github-actions[bot]" \
      -c user.email="41898282+github-actions[bot]@users.noreply.github.com" \
      commit-tree "$tree" -m "checkpoint $branch $(date -u +%FT%TZ)")
    unset GIT_INDEX_FILE
    rm -rf "$tmpd"
    git push -q --force origin "$commit:refs/heads/$branch"
    echo "synced $dir -> $branch (${commit:0:7})"
    ;;
  watch)
    last=""
    while sleep "${CHECKPOINT_POLL_S:-20}"; do
      [ -f "$dir/manifest.json" ] || continue
      now=$(sha256sum "$dir/manifest.json" | cut -d' ' -f1)
      if [ "$now" != "$last" ]; then
        "$0" sync "$dir" "$branch" || echo "checkpoint sync failed (will retry)"
        last=$now
      fi
    done
    ;;
  *)
    echo "unknown command $cmd" >&2
    exit 1
    ;;
esac
