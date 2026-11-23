#!/usr/bin/env bash
# Docker deploy entry point on the E-LOTO server, installed as /opt/eloto-deploy/deploy.sh.
# GitHub Actions' key is pinned to this script in ~/.ssh/authorized_keys
# (command="/opt/eloto-deploy/deploy.sh",restrict), so it can only stream a release
# archive on stdin; the release id arrives as SSH_ORIGINAL_COMMAND.
# DB migrations are intentionally manual: docker compose run --rm migrate
set -Eeuo pipefail

release_id="${SSH_ORIGINAL_COMMAND:-${1:-}}"
if [[ ! "$release_id" =~ ^[a-f0-9]{40}-[0-9]+$ ]]; then
  echo "Invalid release identifier." >&2
  exit 2
fi

app=/opt/eloto
work=/opt/eloto-deploy
exec 9>"$work/deploy.lock"
flock -n 9 || { echo "Another deploy is running." >&2; exit 1; }
test -s "$app/.env" || { echo "Missing $app/.env" >&2; exit 1; }

incoming="$(mktemp -d "$work/incoming.XXXXXX")"
trap 'rm -rf "$incoming"' EXIT
head -c 100000000 | tar -xzf - -C "$incoming"
for f in compose.yaml docker/backend.Dockerfile docker/web.Dockerfile backend/server.js; do
  test -f "$incoming/$f" || { echo "Release archive is missing $f" >&2; exit 1; }
done

# Keep the running images so a failed release can be rolled back.
for image in eloto-backend eloto-web; do
  if docker image inspect "$image:latest" >/dev/null 2>&1; then
    docker tag "$image:latest" "$image:previous"
  fi
done

rsync -a --delete --exclude=/.env --exclude=/.release "$incoming/" "$app/"
cd "$app"
docker compose build --pull
if docker compose up -d --wait --wait-timeout 180; then
  printf '%s\n' "$release_id" > "$app/.release"
  docker image prune -f >/dev/null
  echo "Deployed release $release_id."
  exit 0
fi

echo "New release did not become healthy; restoring previous images." >&2
docker compose logs --tail=40 backend >&2 || true
for image in eloto-backend eloto-web; do
  if docker image inspect "$image:previous" >/dev/null 2>&1; then
    docker tag "$image:previous" "$image:latest"
  fi
done
docker compose up -d --no-build --wait --wait-timeout 180 || true
exit 1
