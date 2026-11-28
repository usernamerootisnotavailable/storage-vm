# Agent and Contributor Rules

This file is the short, enforceable rulebook for every change in this repository. Read it before editing any file.

## Required reading order

1. `README.md`
2. `AGENTS.md` (this file)
3. `docs/ARCHITECTURE.md`
4. `docs/VARIABLES.md`
5. `docs/SECRETS.md`
6. `docs/ENVIRONMENTS.md`
7. `docs/TESTING.md`
8. `docs/CONTRIBUTING.md`
9. `docs/COMPONENTS.md`
10. `docs/DATABASES.md`
11. The relevant file in `docs/components/`

If a rule is unclear, stop and ask. Do not invent a new convention silently.

## Hard rules

### Secrets

- Never commit plaintext passwords, tokens, private keys, age identities, or decrypted SOPS output.
- Never run `sops --decrypt` with output redirected to a file in the repository or a shared temporary directory.
- Never paste decrypted values into chat, issue trackers, pull requests, logs, or commit messages.
- Never add, remove, or change a recipient in `.sops.yaml` without a security review.
- Never place an age private key on a managed host. Decryption happens on the controller.
- Never use a production age key outside the protected production deployment environment.
- Test secrets must be generated at runtime and must never be reused outside tests.

### Environment independence

- Roles and playbooks must not branch on environment name, hostname, IP address, domain, or inventory path.
- `deployment_environment` is metadata only. It must not appear in a `when:`, template conditional, or path.
- Use capability or sizing variables instead of environment names. For example, use `postgresql_apps` CIDRs, not `if environment == "prod"`.
- Use the same variable names, group names, logical hostnames, paths, and task order in every environment.
- Do not use `extra_vars` for normal configuration. It is allowed only for ephemeral test secrets and documented emergency overrides.
- Do not read environment-specific files from inside a role.

### Versions and dependencies

- Pin every collection in `requirements.yml`.
- Pin every Python tool in `requirements-dev.txt`.
- Pin container images by tag or digest in test and CI configuration. Never use `latest`.
- Pin component major versions in inventory; never use `state: latest` for packages.
- Do not silently upgrade a component as part of an unrelated change.

### Platform and security

- Target AlmaLinux 10 only.
- Never disable SELinux or set it permissive to make a task pass.
- Never disable firewalld or open a port to the world to make a test pass.
- Never set `host_key_checking = False`, `StrictHostKeyChecking=no`, or disable GPG signature checks.
- Use dedicated service users with no login shell where the package supports it.
- Configuration files containing secrets must be mode `0600` or `0640` with a restrictive group.
- Do not put secrets in process arguments. Use files or environments with restrictive permissions.

### Code quality

- Use fully qualified collection names (FQCN) for every module, role, and plugin.
- Use modules instead of `shell`/`command`. If a command is unavoidable, use `argv`, add `changed_when` or `creates`, and explain why.
- Do not add `ignore_errors: true` or `failed_when: false` to hide a failure.
- Handlers must restart services only after configuration changes.
- Every role must have `meta/argument_specs.yml`, `defaults/main.yml`, and a README.
- Every task must be idempotent. The second run must report `changed=0`.
- Check mode must not modify the target. Read-only commands may set `check_mode: false`; mutating commands may not.
- Keep role defaults safe and complete. Do not put environment data in role defaults.

## Where values belong

| Value | Location |
|---|---|
| Safe role default | `roles/<role>/defaults/main.yml` |
| Role interface validation | `roles/<role>/meta/argument_specs.yml` |
| Environment metadata and capability flags | `inventories/<env>/group_vars/all/main.yml` |
| Environment values and credentials (encrypted) | `inventories/<env>/group_vars/all/environment.sops.yml` |
| Component versions | `inventories/<env>/group_vars/all/versions.yml` |
| Host hardware exception | `inventories/<env>/host_vars/<host>/main.yml` |
| Connection details (encrypted) | `inventories/<env>/group_vars/all/environment.sops.yml` |
| Secret-to-variable mapping | `inventories/<env>/group_vars/all/environment.sops.yml` |
| OpenTofu-only credentials | `tofu/<env>.sops.yml` |
| Synthetic CI values (plaintext) | `inventories/ci/` |

Never duplicate a value across layers. Set only what differs from the role default.

## Forbidden patterns

```yaml
# Environment branching
when: deployment_environment == "prod"
when: inventory_dir is search("prod")
when: ansible_hostname == "storage01"

# Unpinned versions
state: latest
image: almalinux:latest
version: "*"

# Secret exposure
debug:
  var: postgresql_apps
command: psql "postgresql://app:{{ postgresql_apps[0].password }}@..."
no_log: false

# Hidden failures
ignore_errors: true
failed_when: false

# Role reach-through
postgresql_password: "{{ hostvars['db01']['mariadb_password'] }}"
```

## Required checks before finishing

Run the checks that apply to the change; do not report success for checks you did not run.

```bash
make lint INVENTORY=inventories/ci/hosts.yml       # yamllint, ansible-lint, policy, literals
make syntax INVENTORY=inventories/ci/hosts.yml     # ansible-playbook --syntax-check
make literals                                      # environment-literal scan
make molecule                                      # role converge, verify, idempotence (requires Docker)
make integration                                   # full playbook on the dev container (requires Docker)
```

At minimum, every change must pass `make lint` and `make syntax` with
`INVENTORY=inventories/ci/hosts.yml`. Changes to a role must also pass that
role's Molecule scenario. Changes to `site.yml` or inventory must pass
integration.

## Definition of done

A change is complete only when:

- The implementation follows every rule in this file.
- Variables are documented in `meta/argument_specs.yml` and the role README.
- No plaintext secret is added; `gitleaks` passes.
- The second run is idempotent (`changed=0`).
- `--check --diff` is clean on the development environment.
- Molecule and integration tests pass for the affected roles.
- SELinux and firewall changes have a real-host verification plan.
- Documentation is updated in the same commit.
- Production impact, backup requirements, and rollback steps are documented for destructive changes.

## Scope guardrails

- Do not add a new service, package repository, or network exposure without an approved component entry in `docs/COMPONENTS.md`.
- Do not change the single-host topology without an architecture decision.
- Do not run a playbook against production without explicit human approval.
- Do not commit generated files, caches, collections, virtual environments, or test images.
