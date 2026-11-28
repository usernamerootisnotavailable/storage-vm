#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat >&2 <<'EOF'
Usage: scripts/tofu.sh <dev|prod> <init|fmt|validate|plan|apply> [args...]

All commands require an explicit environment. plan and apply decrypt the
OpenTofu state passphrase from tofu/<env>.sops.yml with SOPS and build
TF_ENCRYPTION in memory.
EOF
  exit 2
}

[[ $# -ge 2 ]] || usage
environment="$1"
command="$2"
shift 2

case "${environment}" in
  dev|prod) ;;
  *) usage ;;
esac

case "${command}" in
  init|fmt|validate|plan|apply) ;;
  *) usage ;;
esac

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "${root}/tofu"

tofu_bin="${TOFU_BIN:-tofu}"
if ! command -v "${tofu_bin}" >/dev/null 2>&1; then
  echo "OpenTofu binary not found: ${tofu_bin}" >&2
  exit 1
fi

required_version="${TOFU_VERSION:-1.12.12}"
actual_version="$("${tofu_bin}" version | awk 'NR == 1 { print $2 }')"
if [[ "${actual_version}" != "v${required_version}" ]]; then
  echo "OpenTofu v${required_version} is required; found ${actual_version}." >&2
  echo "Install the pinned version or set TOFU_BIN to it." >&2
  exit 1
fi

unset TF_ENCRYPTION
unset TF_WORKSPACE
export TF_IN_AUTOMATION=1
export TF_INPUT=0

if [[ "${command}" == "init" || "${command}" == "validate" ]]; then
  if ! command -v openssl >/dev/null 2>&1; then
    echo "Required command not found: openssl" >&2
    exit 1
  fi
fi

set_tf_encryption() {
  local state_passphrase="$1"
  TF_ENCRYPTION="$(
    cat <<EOF
key_provider "pbkdf2" "state" {
  passphrase = "${state_passphrase}"
}
method "aes_gcm" "state" {
  keys = key_provider.pbkdf2.state
}
state {
  method = method.aes_gcm.state
}
plan {
  method = method.aes_gcm.state
}
EOF
  )"
  export TF_ENCRYPTION
}

case "${command}" in
  init)
    # Encryption is enforced in the module. init and validate do not touch
    # state, so use a throwaway passphrase and never write a real state file
    # with it.
    set_tf_encryption "$(openssl rand -hex 32)"
    "${tofu_bin}" init -input=false "$@"
    ;;
  fmt)
    "${tofu_bin}" fmt -check -recursive "$@"
    ;;
  validate)
    if [[ ! -d .terraform ]]; then
      echo "OpenTofu is not initialized. Run: make tf-init ENV=${environment}" >&2
      exit 1
    fi
    set_tf_encryption "$(openssl rand -hex 32)"
    "${tofu_bin}" validate "$@"
    ;;
  plan|apply)
    if [[ ! -d .terraform ]]; then
      echo "OpenTofu is not initialized. Run: make tf-init ENV=${environment}" >&2
      exit 1
    fi

    if ! command -v sops >/dev/null 2>&1; then
      echo "Required command not found: sops" >&2
      exit 1
    fi

    key_file="${SOPS_AGE_KEY_FILE:-${HOME}/.config/sops/age/${environment}.keys.txt}"
    if [[ ! -f "${key_file}" ]]; then
      echo "Age key not found: ${key_file}" >&2
      exit 1
    fi
    export SOPS_AGE_KEY_FILE="${key_file}"

    secret_file="${root}/tofu/${environment}.sops.yml"
    if [[ ! -f "${secret_file}" ]]; then
      echo "OpenTofu secret file not found: ${secret_file}" >&2
      exit 1
    fi

    state_passphrase="$(sops --decrypt --extract '["tofu_state_passphrase"]' "${secret_file}")"
    if [[ ! "${state_passphrase}" =~ ^[0-9a-f]{64}$ ]]; then
      echo "tofu_state_passphrase must be 64 lowercase hex characters." >&2
      exit 1
    fi

    set_tf_encryption "${state_passphrase}"
    unset state_passphrase

    "${tofu_bin}" workspace select -or-create "${environment}" >/dev/null
    export TF_WORKSPACE="${environment}"
    "${tofu_bin}" "${command}" "$@"
    ;;
esac
