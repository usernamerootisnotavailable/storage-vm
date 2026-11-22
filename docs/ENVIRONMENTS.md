# Environments

## Model

There are two deployment environments:

- `dev`
- `prod`

Each is one AlmaLinux 10 host running every service. The environments use the same roles, playbooks, variable names, group names, logical hostname (`storage01`), filesystem paths, and task order.

The environment is selected only by:

- The inventory directory passed with `-i`
- The SOPS age key selected by `SOPS_AGE_KEY_FILE`

`ansible.cfg` defaults to the development inventory so an accidental plain `ansible-playbook site.yml` cannot reach production. Production always requires an explicit `-i inventories/prod/hosts.yml` and the production age key.

## Inventory layout

```text
inventories/dev/
  hosts.yml
  group_vars/
    all/main.yml
    storage/
      main.yml
      versions.yml
      secrets.sops.yml
  host_vars/
    storage01/main.yml

inventories/prod/
  hosts.yml
  group_vars/
    all/main.yml
    storage/
      main.yml
      versions.yml
      secrets.sops.yml
  host_vars/
    storage01/main.yml
```

Both inventories define the same `storage` group and the same logical host `storage01`. Only `ansible_host`, connection details, IP addresses, CIDRs, sizing, certificate source, backup targets, and credentials differ.

## Development transport

The development host is a disposable AlmaLinux 10 systemd container built from `docker/dev/`. It exposes SSH on `127.0.0.1:2222`, using a project-local key under `.dev/ssh/` and a project-local `known_hosts`.

The container is a test harness, not a production topology. It cannot validate:

- SELinux enforcement
- Kernel firewall behavior
- Real block devices or filesystems

Those require a real AlmaLinux 10 host smoke test before a production change is accepted.

## Allowed differences

| Difference | Allowed? | Example |
|---|---|---|
| Connection address and port | Yes | `127.0.0.1:2222` vs a private IP on port 22 |
| SSH key | Yes | Project-local dev key vs operator/CI key |
| Sizing | Yes | Smaller `postgresql_shared_buffers` in dev |
| Allowed client CIDRs | Yes | Empty in dev; application subnet in prod |
| TLS certificate source | Yes | Self-signed in dev; CA-issued in prod |
| Backup target | Yes | Local only in dev; off-host in prod |
| Credentials | Yes | Separate SOPS files and age keys |
| Version during staged rollout | Yes, temporarily | Dev on a new minor before prod, documented |
| Container capability flags | Yes, test harness only | `common_firewall_enabled: false` in dev |
| Role code, playbook order, variable names | No | Must be identical |
| Security controls | No | Never disable SELinux or firewall in prod |
| Environment-based `when:` | No | Use variables instead |

## Capability flags in development

The development container sets:

```yaml
common_manage_time: false
common_firewall_enabled: false
common_require_selinux: false
elasticsearch_manage_sysctl: false
```

These are explicit capability flags, not environment-name branches. They exist because a container shares the host kernel and cannot reliably run chrony, nftables, firewalld, SELinux enforcement, or kernel sysctl changes. Production sets them to `true`; the Docker host must provide `vm.max_map_count=262144` for Elasticsearch.

They must never be used to bypass a failing security task in production. Any change that relies on the difference requires a real-host verification step.

## Secret selection

```bash
# Development
export SOPS_AGE_KEY_FILE="$HOME/.config/sops/age/dev.keys.txt"
ansible-playbook -i inventories/dev/hosts.yml site.yml

# Production
export SOPS_AGE_KEY_FILE="$HOME/.config/sops/age/prod.keys.txt"
ansible-playbook -i inventories/prod/hosts.yml site.yml
```

The wrong key fails during decryption. Do not copy production secrets into the development environment.

## Promotion

Promotion is by commit SHA, not by copying files between environments:

1. Merge to `main`.
2. Deploy the same SHA to `dev`.
3. Run `playbooks/verify.yml` and the service-specific checks.
4. Compare non-secret variable values in `dev` and `prod`. Differences must be on the allowed list.
5. Ensure the production SSH CIDRs include the operator and the automation source.
6. If versions differ, record the staged rollout and its rollback point.
7. Deploy the same SHA to `prod` with approval.
8. Verify production.
9. Update the version files only if the promotion changes a version, then keep both environments aligned.

Never cherry-pick a production-only fix. Fix `main`, deploy `dev`, then promote.

## Production safeguards

Production changes require:

- A reviewed pull request and passing CI
- A current backup or a documented reason one is not needed
- `--check --diff` output reviewed
- The production age key, available only in the protected `prod` GitHub Environment or to an authorized operator
- A maintenance window for disruptive changes
- A rollback point (previous commit SHA and, for data changes, a restore procedure)
- Explicit human approval before applying

Manual changes on production hosts are forbidden. If an emergency change is required, document it, apply it through code as soon as possible, and record the deviation.

## Adding an environment

An additional environment requires an architecture review. If approved:

1. Copy the inventory structure, not the secrets.
2. Create a new age recipient and SOPS file.
3. Add a `.sops.yaml` rule for the new path.
4. Add the host to DNS and the deployment pipeline.
5. Add the environment to CI/CD approval rules.
6. Keep the same group and logical host names.
7. Document any allowed differences.

Do not create a per-environment branch.

## Drift detection

Run check mode regularly against both environments after they have been converged at least once:

```bash
ansible-playbook -i inventories/dev/hosts.yml site.yml --check --diff
ansible-playbook -i inventories/prod/hosts.yml site.yml --check --diff
```

Unexpected diffs indicate manual changes or unmerged configuration. Investigate before applying.
