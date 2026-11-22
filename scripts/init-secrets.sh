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

password="$(openssl rand -hex 32)"
cat > "${plaintext}" <<EOF
secret_postgresql_app_password: "${password}"
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
