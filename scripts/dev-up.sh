#!/usr/bin/env bash
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
key_dir="${root}/.dev/ssh"
key="${key_dir}/id_ed25519"
port="2222"

max_map_count="$(sysctl -n vm.max_map_count 2>/dev/null || echo 0)"
if [[ "${max_map_count}" -lt 262144 ]]; then
  if command -v sudo >/dev/null 2>&1 && sudo -n true 2>/dev/null; then
    sudo sysctl -w vm.max_map_count=262144 >/dev/null
  else
    echo "WARNING: vm.max_map_count is ${max_map_count}; Elasticsearch may fail to start." >&2
  fi
fi

mkdir -p "${key_dir}"
chmod 0700 "${root}/.dev" "${key_dir}"

if [[ ! -f "${key}" ]]; then
  ssh-keygen -q -t ed25519 -N '' -C 'storage-host-dev' -f "${key}"
fi

export DEV_SSH_PUBKEY="${key}.pub"

docker compose -f "${root}/docker/dev/compose.yml" up -d --build

ready=false
for _ in $(seq 1 60); do
  if ssh-keyscan -p "${port}" 127.0.0.1 >/dev/null 2>&1; then
    ready=true
    break
  fi
  sleep 1
done

if [[ "${ready}" != "true" ]]; then
  echo "The development container did not expose SSH on port ${port}." >&2
  docker compose -f "${root}/docker/dev/compose.yml" logs >&2 || true
  exit 1
fi

ssh-keyscan -p "${port}" 127.0.0.1 > "${root}/.dev/known_hosts" 2>/dev/null
chmod 0600 "${root}/.dev/known_hosts"

echo "Development container ready on 127.0.0.1:${port}."
echo "Next: make secrets-dev && make deploy-dev-check"
