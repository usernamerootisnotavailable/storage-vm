# Testing

## Test layers

| Layer | Tool | What it proves |
|---|---|---|
| Formatting | `yamllint` | YAML is valid and consistently formatted |
| Static analysis | `ansible-lint` production profile | Ansible best practices and common failure modes |
| Policy | `scripts/check-policy.sh` | No environment branching, unpinned versions, plaintext keys, or missing role contracts |
| Syntax | `ansible-playbook --syntax-check` | Playbooks, roles, modules, and inventory parse |
| Role behavior | Molecule with Docker | Converge, service health, idempotence |
| Full stack | `site.yml` on the dev container | Roles compose correctly on one AlmaLinux 10 host |
| Security | `gitleaks`, policy checks | No plaintext credentials or age identities |
| Real host | Manual smoke test | SELinux, firewalld, block devices, SSH hardening |

CI is the authoritative test environment. A local pass is necessary but not sufficient.

## Commands

```bash
make lint          # yamllint, ansible-lint, policy checks
make syntax        # syntax-check every playbook
make test-image    # build the AlmaLinux 10 systemd test image
make molecule      # Molecule for all six roles
make integration   # full site.yml on the dev container, twice
make test          # lint + syntax + molecule
```

Run from the repository root unless a target says otherwise. `ansible.cfg` and `ANSIBLE_COLLECTIONS_PATH` make the pinned collections available from role directories.

## AlmaLinux 10 test image

`docker/dev/` builds a systemd-enabled AlmaLinux 10 image with:

- `systemd` as PID 1
- `container=docker` so systemd detects the container environment
- Python 3 for Ansible
- `sudo` and an `ansible` automation user
- `openssh-server` for the persistent development container
- No service packages; roles install them

The image is tagged `storage-host/almalinux10-ansible:10`. Never use `latest`.

Local build:

```bash
make test-image
```

The image is used by both Molecule and the persistent development container.

### Docker prerequisites

- Docker daemon reachable by the current user
- Privileged containers and cgroup namespace support
- `vm.max_map_count=262144` on the Docker host once Elasticsearch is added
- At least 4 GB of memory for the full stack

On Linux:

```bash
sudo sysctl -w vm.max_map_count=262144
```

## Molecule

Each implemented role has `molecule/default/` with:

- `molecule.yml` — Docker driver, pinned image, privileged systemd settings
- `prepare.yml` — verifies AlmaLinux 10
- `converge.yml` — applies `common` and the role
- `verify.yml` — asserts observable behavior

Molecule's `test` sequence includes idempotence: it runs converge a second time and fails if anything changes.

Each scenario sets `ANSIBLE_ROLES_PATH` to the repository `roles/` directory.
Molecule runs from `roles/<role>`, so the relative `roles_path` in
`ansible.cfg` would otherwise resolve inside the role directory and fail the
syntax stage before the container is created.

The scenarios disable only container-incompatible capabilities:

```yaml
common_manage_time: false
common_firewall_enabled: false
common_require_selinux: false
postgresql_manage_firewall: false
mariadb_manage_firewall: false
elasticsearch_manage_firewall: false
elasticsearch_manage_sysctl: false
```

SELinux tasks detect `getenforce` and skip when the container reports `Disabled`. This branch is not exercised in CI.

Test secrets are generated at runtime with the `password` lookup and stored outside the repository:

```yaml
postgresql_apps:
  - state: present
    name: app
    user: app
    password: >-
      {{ lookup('password', '/tmp/mol-pg-app length=32 chars=ascii_letters,digits') }}
    databases:
      - appdb
    cidrs:
      - 127.0.0.1/32
  - state: present
    name: analytics
    user: analytics
    password: >-
      {{ lookup('password', '/tmp/mol-pg-analytics length=32 chars=ascii_letters,digits') }}
    databases:
      - analyticsdb
    cidrs:
      - 127.0.0.1/32
mariadb_apps:
  - state: present
    name: app
    user: app
    password: >-
      {{ lookup('password', '/tmp/mol-mariadb-app length=32 chars=ascii_letters,digits') }}
    databases:
      - appdb
    cidrs:
      - 127.0.0.1/32
  - state: present
    name: analytics
    user: analytics
    password: >-
      {{ lookup('password', '/tmp/mol-mariadb-analytics length=32 chars=ascii_letters,digits') }}
    databases:
      - analyticsdb
    cidrs:
      - 127.0.0.1/32
```

The same files are reused by converge and verify. They are never committed.
The MariaDB scenario proves two applications with distinct accounts and
databases. The role's `mariadb_host_from_cidr` filter maps exact IPv4 hosts and
IPv4 network/netmask hosts; broader IPv6 networks fail by design.

## Full-stack integration

The integration target starts the development container, generates ephemeral credentials for every service, applies `site.yml`, and runs verification. It logs in as each present development PostgreSQL app over `127.0.0.1` with TLS and asserts the database, user, and SSL state. It also logs in as each present development MariaDB app over `127.0.0.1` with the MariaDB CA, asserting `DATABASE()`, `CURRENT_USER()`, and a non-empty `Ssl_cipher`. The MariaDB proof runs only when present `mariadb_apps` entries exist. It then creates a test index, creates and reads an Elasticsearch snapshot through the shared read/write Garage S3 key, and always deletes the snapshot and index. Finally it applies `site.yml` again and asserts `changed=0`. Verification also includes a Garage-backed snapshot repository check and NGINX TLS routing to both Elasticsearch and Garage. Development NGINX uses generated certificates, so integration never contacts Let's Encrypt or Cloudflare.

The database login proofs run against development loopback addresses with
generated TLS material. See [Database applications](DATABASES.md) for the
application verification policy and ownership boundaries. These are development
proofs and do not demonstrate production application connectivity.

```bash
make integration
```

The integration job must not use production secrets. It supplies test credentials through an ephemeral extra-vars file and never touches SOPS-encrypted production data.

The Docker host must provide `vm.max_map_count=262144`; the integration and `dev-up` scripts attempt to raise it when passwordless sudo is available.

## GitHub Actions

`.github/workflows/ci.yml` runs on pull requests and pushes to `main`:

1. **lint** — `yamllint`, `ansible-lint`, `shellcheck`, policy checks, syntax check
2. **secret-scan** — `gitleaks` with a pinned binary
3. **molecule** — matrix over `common`, `postgresql`, `mariadb`, `garage`, `elasticsearch`, and `nginx`
4. **integration** — full `site.yml` on the AlmaLinux 10 container, including the Garage S3 snapshot repository, an Elasticsearch snapshot create/read/delete proof with the shared read/write key, and NGINX TLS routing

Requirements:

- Actions are pinned by commit SHA.
- Tool versions come from `requirements-dev.txt`.
- Collections come from `requirements.yml`.
- Pull requests from forks do not receive environment secrets.
- CI must not print decrypted variables.
- A failing security check blocks merge.

Branch protection must require the lint, secret-scan, molecule, and integration checks.

## Check mode

- Every task must be safe in check mode or explicitly documented.
- Read-only commands may use `check_mode: false` so they can gather facts during a check run.
- Mutating commands must never use `check_mode: false`.
- Check mode is meaningful on a host that has been converged once. On a blank host, package installation and directory creation are simulated, so the first apply must establish baseline state.
- `--check --diff` is used for drift detection on development and as a pre-apply review on production.

## Idempotence

The second convergence must report `changed=0`. Common causes of non-idempotence:

- Password modules that rewrite credentials on every run
- `command`/`shell` tasks without `creates` or `changed_when`
- Templates with timestamps or random data
- Repository or GPG key tasks that re-download every time
- Handlers notified unconditionally

Do not hide a change with `changed_when: false` unless the task is genuinely read-only.

## Known gaps

Docker cannot validate:

- SELinux enforcing behavior and file contexts, including the MariaDB vendor policy
- Garage and Elasticsearch unconfined SELinux domains
- NGINX `httpd_t` to `http_port_t` upstream policy
- nftables/firewalld behavior against a real network
- Let's Encrypt DNS-01, Cloudflare API access, and public DNS
- Real disk layout, I/O, or filesystem tuning
- SSH access from an external network

Before a production change that touches these areas:

1. Apply the change to a real AlmaLinux 10 host in a non-production environment.
2. Verify SELinux denials with `ausearch -m avc -ts recent`.
3. Verify firewall rules from an allowed and a denied source.
4. Verify SSH access with the intended automation and admin users.
5. Verify NGINX from an allowed and a denied network, and confirm `httpd_t` can connect to the labeled upstream ports.
6. Verify Let's Encrypt issuance/renewal and the Cloudflare DNS token scope when using production certificate mode.
7. Record the verification in the pull request.

## Definition of done

- `make lint` passes.
- `make syntax` passes.
- The affected role's Molecule scenario passes.
- Integration passes for changes to `site.yml` or inventory.
- The second run reports `changed=0`.
- `gitleaks` passes.
- No real-host-only gap is left unverified without a documented plan.
