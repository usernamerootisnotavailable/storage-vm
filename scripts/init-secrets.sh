#!/usr/bin/env bash
set -euo pipefail

usage() {
  echo "Usage: $0 <dev|prod>" >&2
  exit 2
}

[[ $# -eq 1 ]] || usage
environment="$1"

case "${environment}" in
  dev|prod) ;;
  *) usage ;;
esac

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
output="${root}/inventories/${environment}/group_vars/storage/secrets.sops.yml"

if [[ -e "${output}" ]]; then
  echo "${output} already exists; refusing to overwrite." >&2
  exit 1
fi

for command in sops openssl; do
  if ! command -v "${command}" >/dev/null 2>&1; then
    echo "Required command not found: ${command}" >&2
    exit 1
  fi
done

plaintext="$(mktemp)"
temporary_output="${output}.tmp"
trap 'rm -f "${plaintext}" "${temporary_output}"' EXIT
chmod 0600 "${plaintext}"

postgresql_password="$(openssl rand -hex 32)"
mariadb_password="$(openssl rand -hex 32)"
garage_rpc_secret="$(openssl rand -hex 32)"
garage_admin_token="$(openssl rand -hex 32)"
s3_access_key="$(openssl rand -hex 8)"
s3_secret_key="$(openssl rand -hex 32)"
elasticsearch_bootstrap_password="$(openssl rand -hex 32)"

cat > "${plaintext}" <<EOF
secret_postgresql_app_password: "${postgresql_password}"
secret_mariadb_app_password: "${mariadb_password}"
secret_garage_rpc_secret: "${garage_rpc_secret}"
secret_garage_admin_token: "${garage_admin_token}"
secret_storage_s3_access_key: "${s3_access_key}"
secret_storage_s3_secret_key: "${s3_secret_key}"
secret_elasticsearch_bootstrap_password: "${elasticsearch_bootstrap_password}"
EOF

if ! sops --encrypt \
  --filename-override "${output}" \
  --input-type yaml \
  --output-type yaml \
  --output "${temporary_output}" \
  "${plaintext}"; then
  echo "SOPS encryption failed. Check that .sops.yaml has a matching recipient for ${environment}." >&2
  exit 1
fi

chmod 0600 "${temporary_output}"
mv "${temporary_output}" "${output}"
trap - EXIT
rm -f "${plaintext}"

echo "Created ${output}"
echo "Verify with: sops --decrypt ${output} >/dev/null"
