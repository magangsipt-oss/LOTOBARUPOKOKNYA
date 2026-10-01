#!/usr/bin/env bash
set -Eeuo pipefail

release_id="${1:-}"
deploy_root="${2:-}"
activate="${3:-false}"
if [[ ! "$release_id" =~ ^[a-f0-9]{40,64}-[0-9]+$ ]]; then
  echo "Invalid release identifier." >&2
  exit 2
fi
if [[ "$deploy_root" != "/srv/eloto" ]]; then
  echo "Unexpected deployment path; this workflow is configured for /srv/eloto." >&2
  exit 2
fi
if [[ "$activate" != true && "$activate" != false ]]; then
  echo "Activation flag must be true or false." >&2
  exit 2
fi

archive="$deploy_root/incoming/$release_id.tar.gz"
release="$deploy_root/releases/$release_id"
current="$deploy_root/current"
service="eloto-backend.service"

for command in node corepack tar curl sudo; do
  command -v "$command" >/dev/null || { echo "Missing server prerequisite: $command" >&2; exit 1; }
done
node -e 'if (Number(process.versions.node.split(".")[0]) < 22) process.exit(1)' || {
  echo "Node.js 22 or newer is required on the VPS." >&2
  exit 1
}
test -s "$archive" || { echo "Uploaded release archive is missing." >&2; exit 1; }
test -s "$deploy_root/shared/backend.env" || {
  echo "Create /srv/eloto/shared/backend.env before deploying." >&2
  exit 1
}

mkdir -p "$deploy_root/shared/uploads" "$deploy_root/shared/legacy-uploads" "$release"
tar -xzf "$archive" -C "$release"
ln -s "$deploy_root/shared/backend.env" "$release/backend/.env"

# Keep profile photos across releases, including data from a previous layout.
for media_dir in uploads legacy-uploads; do
  old_media="$current/backend/$media_dir"
  if [[ -d "$old_media" && ! -L "$old_media" ]]; then
    cp -a "$old_media/." "$deploy_root/shared/$media_dir/"
  fi
  new_media="$release/backend/$media_dir"
  if [[ -d "$new_media" && ! -L "$new_media" ]]; then
    cp -a "$new_media/." "$deploy_root/shared/$media_dir/"
    rm -rf "$new_media"
  fi
  rm -f "$new_media"
  ln -s "$deploy_root/shared/$media_dir" "$new_media"
done

(
  cd "$release"
  corepack pnpm install --prod --filter backend --frozen-lockfile
)

if [[ "$activate" != true ]]; then
  rm -f "$archive"
  echo "Prepared release at $release. Review/backup the database, then run the documented migration before activating it."
  exit 0
fi

test -f "/etc/systemd/system/$service" || {
  echo "Install the eloto-backend systemd unit before activating a release." >&2
  exit 1
}

previous=""
if [[ -L "$current" ]]; then
  previous="$(readlink -f "$current" || true)"
fi
next_link="$deploy_root/current.next.$$"
ln -s "$release" "$next_link"
mv -Tf "$next_link" "$current"

rollback() {
  if [[ -n "$previous" && -d "$previous" ]]; then
    next_link="$deploy_root/current.rollback.$$"
    ln -s "$previous" "$next_link"
    mv -Tf "$next_link" "$current"
    sudo -n /usr/bin/systemctl restart "$service" || true
  fi
}

if ! sudo -n /usr/bin/systemctl restart "$service"; then
  rollback
  echo "Backend service restart failed; previous release restored when available." >&2
  exit 1
fi

ready=false
for _ in $(seq 1 30); do
  if curl --fail --silent --show-error --max-time 3 http://127.0.0.1:5002/health/ready >/dev/null 2>&1; then
    ready=true
    break
  fi
  sleep 2
done

service_state="$(sudo -n /usr/bin/systemctl is-active "$service" || true)"
if [[ "$ready" != true || "$service_state" != active ]]; then
  rollback
  echo "Backend readiness check failed; inspect journalctl for $service." >&2
  exit 1
fi

rm -f "$archive"
echo "Deployed release $release_id successfully."
