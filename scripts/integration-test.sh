#!/usr/bin/env bash
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "${root}"

export ANSIBLE_CONFIG="${root}/ansible.cfg"
export ANSIBLE_COLLECTIONS_PATH="${root}/collections"
ansible_playbook="${ANSIBLE_PLAYBOOK:-ansible-playbook}"
secret_file="${TMPDIR:-/tmp}/storage-host-ci-test-secrets.yml"

generate_secrets() {
  umask 077
  {
    echo "---"
    printf 'secret_postgresql_app_password: "%s"\n' "$(openssl rand -hex 32)"
    printf 'secret_mariadb_app_password: "%s"\n' "$(openssl rand -hex 32)"
    printf 'secret_garage_rpc_secret: "%s"\n' "$(openssl rand -hex 32)"
    printf 'secret_garage_admin_token: "%s"\n' "$(openssl rand -hex 32)"
    printf 'secret_storage_s3_access_key: "%s"\n' "$(openssl rand -hex 8)"
    printf 'secret_storage_s3_secret_key: "%s"\n' "$(openssl rand -hex 32)"
    printf 'secret_elasticsearch_bootstrap_password: "%s"\n' "$(openssl rand -hex 32)"
  } > "${secret_file}"
}

if [[ ! -f "${secret_file}" ]] ||
  ! grep -q '^secret_mariadb_app_password:' "${secret_file}" ||
  ! grep -q '^secret_postgresql_app_password:' "${secret_file}" ||
  ! grep -q '^secret_storage_s3_access_key:' "${secret_file}"; then
  generate_secrets
fi
chmod 0600 "${secret_file}"

max_map_count="$(sysctl -n vm.max_map_count 2>/dev/null || echo 0)"
if [[ "${max_map_count}" -lt 262144 ]]; then
  if command -v sudo >/dev/null 2>&1 && sudo -n true 2>/dev/null; then
    sudo sysctl -w vm.max_map_count=262144 >/dev/null
  else
    echo "WARNING: vm.max_map_count is ${max_map_count}; Elasticsearch may fail to start." >&2
  fi
fi

if [[ "${INTEGRATION_RESET:-true}" == "true" ]]; then
  ./scripts/dev-down.sh
fi
./scripts/dev-up.sh

echo "Applying site.yml with ephemeral test secrets"
"${ansible_playbook}" \
  -i inventories/ci/hosts.yml \
  site.yml \
  --extra-vars "@${secret_file}"

echo "Verifying the host"
"${ansible_playbook}" \
  -i inventories/ci/hosts.yml \
  playbooks/verify.yml \
  --extra-vars "@${secret_file}"

echo "Proving PostgreSQL application logins over TLS"
"${ansible_playbook}" \
  -i inventories/ci/hosts.yml \
  playbooks/integration-database.yml \
  --extra-vars "@${secret_file}"

echo "Testing Elasticsearch snapshot create/delete with the shared S3 key"
"${ansible_playbook}" \
  -i inventories/ci/hosts.yml \
  playbooks/integration-snapshot.yml \
  --extra-vars "@${secret_file}"

echo "Checking idempotence"
second_run="$("${ansible_playbook}" \
  -i inventories/ci/hosts.yml \
  site.yml \
  --extra-vars "@${secret_file}")"
printf '%s\n' "${second_run}"

if grep -Eq 'changed=[1-9][0-9]*' <<< "${second_run}"; then
  echo "The second run was not idempotent." >&2
  exit 1
fi

echo "Integration test passed."
