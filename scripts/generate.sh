#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat >&2 <<'EOF'
Usage: make generate ENV=<dev|prod> [DRY_RUN=1]

Creates the environment's age key when absent, requires a matching
.sops.yaml creation rule, renders the committed examples, encrypts them, and
refuses to overwrite any existing output.
EOF
  exit 2
}

environment=""
dry_run=false

for argument in "$@"; do
  case "${argument}" in
    dev|prod)
      [[ -z "${environment}" ]] || usage
      environment="${argument}"
      ;;
    --dry-run|-n)
      dry_run=true
      ;;
    *)
      usage
      ;;
  esac
done

[[ -n "${environment}" ]] || usage

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "${root}"
key_dir="${HOME}/.config/sops/age"
key_file="${key_dir}/${environment}.keys.txt"

inventory_example="${root}/inventories/${environment}/group_vars/all/environment.sops.yml.example"
inventory_output="${root}/inventories/${environment}/group_vars/all/environment.sops.yml"
tofu_example="${root}/tofu/${environment}.sops.yml.example"
tofu_output="${root}/tofu/${environment}.sops.yml"
sops_config="${root}/.sops.yaml"
renderer="${root}/scripts/render-example.py"

for required in "${inventory_example}" "${tofu_example}" "${sops_config}" "${renderer}"; do
  [[ -f "${required}" ]] || {
    echo "Missing required file: ${required}" >&2
    exit 1
  }
done

for output in "${inventory_output}" "${tofu_output}"; do
  if [[ -e "${output}" ]]; then
    echo "Refusing to overwrite existing file: ${output}" >&2
    exit 1
  fi
done

if [[ "${dry_run}" == "true" ]]; then
  if [[ -f "${key_file}" ]]; then
    echo "DRY RUN: would use the existing age key at ${key_file}"
  else
    echo "DRY RUN: would create the age key at ${key_file}"
  fi
  echo "DRY RUN: a matching .sops.yaml creation rule is required before encryption"
  echo "DRY RUN: would render and encrypt:"
  echo "  ${inventory_example} -> ${inventory_output}"
  echo "  ${tofu_example} -> ${tofu_output}"
  echo "DRY RUN: no files changed"
  exit 0
fi

for command in age-keygen python3 sops; do
  if ! command -v "${command}" >/dev/null 2>&1; then
    echo "Required command not found: ${command}" >&2
    exit 1
  fi
done

if [[ ! -f "${key_file}" ]]; then
  install -d -m 0700 "${key_dir}"
  age-keygen -o "${key_file}" >/dev/null 2>&1
  chmod 0600 "${key_file}"
  echo "Created age key: ${key_file}"
fi

recipient="$(age-keygen -y "${key_file}")"
export SOPS_AGE_KEY_FILE="${key_file}"

umask 077
temporary_directory="$(mktemp -d)"
trap 'rm -rf "${temporary_directory}"' EXIT

examples=("${inventory_example}" "${tofu_example}")
outputs=("${inventory_output}" "${tofu_output}")
encrypted_files=()

for index in "${!examples[@]}"; do
  example="${examples[${index}]}"
  output="${outputs[${index}]}"
  relative_output="${output#"${root}/"}"
  rendered="${temporary_directory}/rendered-${index}.yml"
  encrypted="${temporary_directory}/encrypted-${index}.yml"

  python3 "${renderer}" "${example}" "${rendered}"

  if ! sops --encrypt \
    --filename-override "${relative_output}" \
    --input-type yaml \
    --output-type yaml \
    --output "${encrypted}" \
    "${rendered}"; then
    echo "SOPS encryption failed for ${output}." >&2
    echo "Add this public recipient to a matching .sops.yaml creation rule:" >&2
    echo "  ${recipient}" >&2
    echo "Then re-run: make generate ENV=${environment}" >&2
    exit 1
  fi

  if ! sops --decrypt "${encrypted}" >/dev/null 2>&1; then
    echo "The generated file for ${output} is not readable by ${key_file}." >&2
    echo "The .sops.yaml rule must use this public recipient:" >&2
    echo "  ${recipient}" >&2
    exit 1
  fi

  chmod 0600 "${encrypted}"
  encrypted_files+=("${encrypted}")
done

for index in "${!outputs[@]}"; do
  output="${outputs[${index}]}"
  install -d -m 0755 "$(dirname "${output}")"
  mv "${encrypted_files[${index}]}" "${output}"
  echo "Created ${output}"
done

echo
echo "Next steps:"
echo "  1. sops ${inventory_output}"
echo "  2. sops ${tofu_output}"
echo "  3. Run the checks with INVENTORY=inventories/ci/hosts.yml"
