# Storage Host

Ansible configuration for an AlmaLinux 10 storage host running:

- **Elasticsearch** 9.5
- **PostgreSQL** 18
- **MariaDB** 11.8
- **Garage** 2.5 (S3-compatible object storage)
- **NGINX** 1.26 with Let's Encrypt certificates via Certbot DNS-01 and Cloudflare

One host runs all services per environment. Development and production use the same roles, playbooks, and variable names; only inventory data, credentials, sizing, and endpoints differ.

## Current status

| Area | Status |
|---|---|
| Documentation and repository scaffolding | Implemented |
| `common` role (AlmaLinux baseline) | Implemented |
| PostgreSQL 18 role | Implemented |
| MariaDB 11.8 role | Implemented |
| Garage 2.5 role | Implemented |
| Elasticsearch 9.5 role | Implemented |
| NGINX private TLS reverse proxy | Implemented |
| Full-stack integration | Implemented (all services, Garage snapshots, NGINX routing) |
| Encrypted environment files and generation | Generation flow implemented; human runs `make generate` |
| Synthetic CI inventory | Implemented (`inventories/ci`) |

`site.yml` applies `common`, PostgreSQL, MariaDB, Garage, Elasticsearch, NGINX, and verification in dependency order. Garage is configured before Elasticsearch so the snapshot repository can be registered and verified. NGINX runs after Elasticsearch so it can trust the Elasticsearch CA.

## Supported platform

- AlmaLinux 10 x86_64
- Ansible core 2.22+
- Python 3.12+ on managed hosts
- systemd, SELinux, and firewalld

Only AlmaLinux 10 is supported. Do not add workarounds for other distributions without an explicit architecture decision.

## Prerequisites

On the controller:

- `ansible-core` 2.22 or newer
- The collections pinned in `requirements.yml`
- `sops` 3.12+ with `age` for encrypted variables
- Docker with a running daemon for local Molecule and integration tests
- `vm.max_map_count=262144` on the Docker host for Elasticsearch; `make dev-up`
  attempts to raise it when passwordless sudo is available
- For production Let's Encrypt: a Cloudflare-managed domain, a scoped API token,
  and a Let's Encrypt account email
- `make`, `git`, and `ssh`

On managed hosts:

- A bootstrap automation user with key-based SSH access and sudo
- Outbound HTTPS access to vendor package repositories
- A valid host key in `known_hosts`

## Quick start

```bash
# Controller dependencies
python3 -m venv .venv
. .venv/bin/activate
pip install -r requirements-dev.txt
ansible-galaxy collection install -r requirements.yml -p ./collections

# Lint, syntax, literal, and policy checks
make lint INVENTORY=inventories/ci/hosts.yml
make syntax INVENTORY=inventories/ci/hosts.yml

# Start the disposable AlmaLinux 10 development container
make dev-up

# Preview environment generation, then create the encrypted development files.
# The first run creates the age key and prints the public recipient. Add it to
# .sops.yaml, then run the same command again.
make generate ENV=dev DRY_RUN=1
make generate ENV=dev

# Edit the encrypted files and replace every <REPLACE_WITH_...> placeholder.
sops inventories/dev/group_vars/all/environment.sops.yml
sops tofu/dev.sops.yml

# First convergence, then a drift check
make deploy-dev
make deploy-dev-check
make verify
```

Check mode is most useful after the host has been converged once. On a blank
host, package installation and directory creation cannot be fully simulated.

Production is always explicit:

```bash
ansible-playbook -i inventories/prod/hosts.yml site.yml --check --diff
ansible-playbook -i inventories/prod/hosts.yml site.yml
```

Production deployment requires approval, a backup, and the production age key. Set the production SSH and NGINX HTTPS CIDRs before enabling the firewall, and include the operator and automation source addresses. Production NGINX uses Let's Encrypt DNS-01 through Cloudflare; the private server needs no inbound HTTP challenge. See `docs/ENVIRONMENTS.md` and `docs/components/nginx.md`.

## Documentation

| Document | Purpose |
|---|---|
| [`AGENTS.md`](AGENTS.md) | Hard rules for all future work |
| [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) | Topology, decisions, repository layout, AlmaLinux baseline |
| [`docs/VARIABLES.md`](docs/VARIABLES.md) | Variable naming, precedence, and validation |
| [`docs/SECRETS.md`](docs/SECRETS.md) | SOPS/age workflow, key custody, rotation, CI |
| [`docs/ENVIRONMENTS.md`](docs/ENVIRONMENTS.md) | dev/prod inventories, allowed differences, promotion |
| [`docs/TESTING.md`](docs/TESTING.md) | Test layers, Molecule, GitHub Actions, known gaps |
| [`docs/CONTRIBUTING.md`](docs/CONTRIBUTING.md) | Change workflow and review checklist |
| [`docs/COMPONENTS.md`](docs/COMPONENTS.md) | Component contracts and verified platform data |
| [`docs/DATABASES.md`](docs/DATABASES.md) | Cross-engine policy for PostgreSQL and MariaDB applications |
| [`docs/components/postgresql.md`](docs/components/postgresql.md) | PostgreSQL role reference |
| [`docs/components/mariadb.md`](docs/components/mariadb.md) | MariaDB role reference |
| [`docs/components/garage.md`](docs/components/garage.md) | Garage role reference |
| [`docs/components/elasticsearch.md`](docs/components/elasticsearch.md) | Elasticsearch role reference |
| [`docs/components/nginx.md`](docs/components/nginx.md) | NGINX, Certbot, Cloudflare DNS-01, and private exposure |

## Non-negotiables

1. No plaintext secrets in the repository, tickets, logs, or chat. Secret values live in environment-scoped SOPS files.
2. One code path for every environment. Environment identity never appears in role logic.
3. Pin versions and collection dependencies. Never use `latest`.
4. Keep SELinux enforcing and the firewall enabled in production. Never disable a security control to make a test pass.
5. Keep NGINX private. Port 443 accepts only explicit private or VPN CIDRs; public CIDRs and port 80 are forbidden.
6. Every change must be idempotent, linted, tested, and documented.
