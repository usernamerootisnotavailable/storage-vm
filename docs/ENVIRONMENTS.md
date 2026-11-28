# Environments

## Model

There are two deployment environments:

- `dev`
- `prod`

Each is one AlmaLinux 10 host running every service. The environments use the same roles, playbooks, variable names, group names, logical hostname (`storage01`), filesystem paths, and task order.

The environment is selected only by:

- The inventory directory passed with `-i`
- The SOPS age key selected by `SOPS_AGE_KEY_FILE`

`ansible.cfg` has no default inventory. Every command must pass `-i` or set
`INVENTORY` for the Makefile check targets. Production always requires an
explicit production inventory and the production age key.

## Inventory layout

```text
inventories/dev/
  hosts.yml
  group_vars/
    all/
      main.yml
      versions.yml
      environment.sops.yml
      environment.sops.yml.example
  host_vars/
    storage01/main.yml

inventories/prod/
  hosts.yml
  group_vars/
    all/
      main.yml
      versions.yml
      environment.sops.yml
      environment.sops.yml.example
  host_vars/
    storage01/main.yml

inventories/ci/
  hosts.yml
  group_vars/
    all/
      main.yml
      versions.yml
      environment.yml
  host_vars/
    storage01/main.yml
```

Both deployment inventories define the same `storage` group and the same
logical host `storage01`. `hosts.yml` contains only groups and host names.
Connection details, addresses, CIDRs, domains, sizing, endpoints, backup
settings, public keys, and credentials live in the encrypted
`group_vars/all/environment.sops.yml`.

`environment.sops.yml.example` is the committed plaintext template. Run
`make generate ENV=<dev|prod>` to create the encrypted file, then edit it with
`sops`. The encrypted output is committed; the rendered plaintext is never
committed.

`inventories/ci` is a synthetic, plaintext test inventory. It is not a
deployment environment. It uses loopback for the container connection and
reserved documentation values for everything else. It exists so CI can run
lint, syntax, and integration checks without an age key.

Only `ansible_host`, `ansible_port`, `ansible_user`, SSH key paths, addresses,
CIDRs, domains, sizing, certificate sources, backup targets, and credentials
differ between environments.

## Development transport

The development host is a disposable AlmaLinux 10 systemd container built from `docker/dev/`. Its encrypted environment file points SSH at the project-local key under `.dev/ssh/` and the project-local `known_hosts`.

The container is a test harness, not a production topology. It cannot validate:

- SELinux enforcement, including NGINX `httpd_t` port policy
- Kernel firewall behavior
- Real block devices or filesystems
- Let's Encrypt DNS-01, Cloudflare API access, or public DNS

Development uses `nginx_certificate_mode: generated` and never contacts Let's Encrypt.

Those require a real AlmaLinux 10 host smoke test before a production change is accepted.

## Allowed differences

| Difference | Allowed? | Example |
|---|---|---|
| Connection address and port | Yes | `127.0.0.1:2222` vs a private IP on port 22 |
| SSH key | Yes | Project-local dev key vs operator/CI key |
| Sizing | Yes | Smaller `postgresql_shared_buffers` in dev |
| Allowed client CIDRs | Yes | Empty in dev; application subnet in prod |
| TLS certificate source | Yes | Generated CA in dev; Let's Encrypt in prod |
| HTTPS exposure | Yes | Loopback/private CIDRs; never public |
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

Each environment has its own age key and encrypted environment file:

```bash
# Development
export SOPS_AGE_KEY_FILE="$HOME/.config/sops/age/dev.keys.txt"
ansible-playbook -i inventories/dev/hosts.yml site.yml

# Production
export SOPS_AGE_KEY_FILE="$HOME/.config/sops/age/prod.keys.txt"
ansible-playbook -i inventories/prod/hosts.yml site.yml
```

The wrong key fails during decryption. Do not copy production secrets into the
development environment. Create the files with `make generate ENV=<dev|prod>`
and edit only the encrypted output with `sops`.

## Promotion

Promotion is by commit SHA, not by copying files between environments:

1. Merge to `main`.
2. Deploy the same SHA to `dev`.
3. Run `playbooks/verify.yml` and the service-specific checks.
4. Compare the plaintext versions and capability flags. If authorized, decrypt
   both environment files to compare non-secret values; never print or store the
   decrypted output.
5. Ensure the production SSH and NGINX HTTPS CIDRs include the operator and the automation source; never use public CIDRs for NGINX.
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
- A real domain, scoped Cloudflare DNS token, and Let's Encrypt account email for NGINX
- Private or VPN CIDRs for SSH and NGINX HTTPS
- A maintenance window for disruptive changes
- A rollback point (previous commit SHA and, for data changes, a restore procedure)
- Explicit human approval before applying

Manual changes on production hosts are forbidden. If an emergency change is required, document it, apply it through code as soon as possible, and record the deviation.

## Adding an environment

An additional environment requires an architecture review. If approved:

1. Copy the inventory structure and add the new `environment.sops.yml.example`.
2. Extend `scripts/generate.sh` for the new environment, create a new age
   recipient, and run the generation flow.
3. Add the matching `.sops.yaml` rules for the inventory and OpenTofu files.
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
