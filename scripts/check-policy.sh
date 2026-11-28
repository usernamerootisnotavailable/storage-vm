#!/usr/bin/env bash
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "${root}"

failed=0

fail() {
  echo "POLICY FAILURE: $*" >&2
  failed=1
}

# Required documentation and role contract files.
for document in \
  README.md \
  AGENTS.md \
  docs/ARCHITECTURE.md \
  docs/VARIABLES.md \
  docs/SECRETS.md \
  docs/ENVIRONMENTS.md \
  docs/TESTING.md \
  docs/CONTRIBUTING.md \
  docs/COMPONENTS.md \
  docs/DATABASES.md \
  docs/APP-PROVISIONING.md \
  docs/GARAGE-RUNBOOK.md \
  docs/TOFU.md \
  docs/HANDOFF.md \
  docs/components/postgresql.md \
  docs/components/mariadb.md \
  docs/components/garage.md \
  docs/components/elasticsearch.md \
  docs/components/nginx.md; do
  [[ -f "${document}" ]] || fail "missing ${document}"
done

for role_dir in roles/*/; do
  role="${role_dir%/}"
  for required in \
    defaults/main.yml \
    handlers/main.yml \
    meta/main.yml \
    meta/argument_specs.yml \
    tasks/main.yml \
    README.md; do
    [[ -f "${role}/${required}" ]] || fail "missing ${role}/${required}"
  done
done

# Environment identity must not appear in executable configuration.
if grep -RInE 'deployment_environment|inventory_dir|ansible_hostname' roles playbooks; then
  fail "environment or host identity is referenced in roles or playbooks"
fi

if grep -RInE '^[[:space:]]*when:.*\b(dev|prod)\b' roles playbooks; then
  fail "environment-name condition found in roles or playbooks"
fi

# No unpinned package or image state.
if grep -RInE '^[[:space:]]*state:[[:space:]]*latest' roles playbooks; then
  fail "state: latest is forbidden"
fi

if grep -RInE '(^|[[:space:]])image:.*:latest|^[[:space:]]*FROM[[:space:]]+[^[:space:]]+:latest' \
  docker roles .github inventories; then
  fail ":latest container images are forbidden"
fi

# No hidden failures.
if grep -RInE 'ignore_errors:[[:space:]]*true|failed_when:[[:space:]]*false' roles playbooks; then
  fail "ignore_errors/failed_when false hides failures"
fi

# No plaintext private keys.
if grep -RInE 'AGE-SECRET-KEY-1|BEGIN (OPENSSH|RSA|EC|DSA|PRIVATE) KEY' \
  --exclude-dir=.git \
  --exclude-dir=.venv \
  --exclude-dir=collections \
  --exclude-dir=.molecule \
  --exclude-dir=docs \
  --exclude=check-policy.sh \
  .; then
  fail "private key material found in the repository"
fi

# Every SOPS file must be encrypted.
while IFS= read -r sops_file; do
  if ! grep -q '^sops:' "${sops_file}"; then
    fail "${sops_file} is not SOPS-encrypted"
  fi
done < <(find . -name '*.sops.yml' -not -path './.git/*' -not -path './collections/*')

if find . -name '*.sops.yml' -not -path './.git/*' -not -path './collections/*' | grep -q .; then
  if grep -q '^creation_rules: \[\]' .sops.yaml; then
    fail ".sops.yaml has no recipients while encrypted files exist"
  fi
fi

# Controller security settings.
grep -q '^host_key_checking = True' ansible.cfg || fail "host_key_checking must be True"
grep -q '^register_values_as_secrets = True' ansible.cfg || fail "SOPS secret masking must be enabled"
if grep -q '^log_path' ansible.cfg; then
  fail "log_path is forbidden because it can retain sensitive output"
fi
if grep -qE '^inventory[[:space:]]*=' ansible.cfg; then
  fail "ansible.cfg must not define a default inventory"
fi
if grep -qE '^INVENTORY[[:space:]]*\?=' Makefile; then
  fail "Makefile must not define a default INVENTORY"
fi

# Every environment must have committed generation templates. The encrypted
# outputs are produced by a human with `make generate` and are not present in a
# clean checkout.
for environment in dev prod; do
  [[ -f "inventories/${environment}/group_vars/all/environment.sops.yml.example" ]] || \
    fail "missing inventories/${environment}/group_vars/all/environment.sops.yml.example"
  [[ -f "inventories/${environment}/group_vars/all/infrastructure.sops.yml.example" ]] || \
    fail "missing inventories/${environment}/group_vars/all/infrastructure.sops.yml.example"
  [[ -f "tofu/${environment}.sops.yml.example" ]] || \
    fail "missing tofu/${environment}.sops.yml.example"
  if grep -vE '^[[:space:]]*#' \
    "inventories/${environment}/group_vars/all/infrastructure.sops.yml.example" |
    grep -qE 'secret_|password|token'; then
    fail "infrastructure.sops.yml.example must not contain credentials"
  fi
done

# Inventory parity, dependency pinning, and version parity.
python3 - <<'PY'
import sys
import yaml


def requirements(path):
    with open(path, encoding="utf-8") as handle:
        return yaml.safe_load(handle) or {}


def inventory(path):
    with open(path, encoding="utf-8") as handle:
        data = yaml.safe_load(handle) or {}
    groups = set()
    hosts = set()

    def walk(node):
        for group, body in (node.get("children") or {}).items():
            groups.add(group)
            walk(body or {})
        for host in (node.get("hosts") or {}):
            hosts.add(host)

    walk(data.get("all") or {})
    return groups, hosts


def versions(path):
    with open(path, encoding="utf-8") as handle:
        return yaml.safe_load(handle) or {}


dev_inventory = inventory("inventories/dev/hosts.yml")
prod_inventory = inventory("inventories/prod/hosts.yml")
ci_inventory = inventory("inventories/ci/hosts.yml")
if dev_inventory != prod_inventory:
    sys.exit("dev and prod inventories must expose the same groups and hosts")
if dev_inventory != ci_inventory:
    sys.exit("the CI inventory must expose the same groups and hosts as dev and prod")

dev_versions = versions("inventories/dev/group_vars/all/versions.yml")
prod_versions = versions("inventories/prod/group_vars/all/versions.yml")
ci_versions = versions("inventories/ci/group_vars/all/versions.yml")
if dev_versions != prod_versions:
    sys.exit("dev and prod component versions differ; use a documented staged rollout")
if dev_versions != ci_versions:
    sys.exit("the CI component versions differ from dev and prod")

for collection in requirements("requirements.yml").get("collections", []):
    if not collection.get("version"):
        sys.exit(f"collection {collection.get('name', '<unnamed>')} is not pinned")
PY

if [[ "${failed}" -ne 0 ]]; then
  exit 1
fi

echo "Policy checks passed."
