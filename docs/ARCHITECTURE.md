# Architecture

## Purpose

This repository configures a single AlmaLinux 10 host per environment with four storage services:

- Elasticsearch for search and analytics
- PostgreSQL for relational data
- MariaDB for relational data
- Garage for S3-compatible object storage

The same roles and playbooks run in development and production. Environment differences are confined to inventory, credentials, sizing, endpoints, and capability flags required by the test harness.

## Locked decisions

| Decision | Choice | Consequence |
|---|---|---|
| Secret management | SOPS + age | Encrypted `*.sops.yml` files are committed; age keys never enter the repository |
| Environments | `dev` and `prod` | Identical inventory structure and logical hostnames |
| Topology | One all-in-one host per environment | No clustering, replication, or multi-host orchestration |
| Local validation | Docker AlmaLinux 10 systemd container | Fast role tests; SELinux and firewall require a real host |
| CI | GitHub Actions | Lint, policy, secret scan, Molecule, integration |
| Platform | AlmaLinux 10 x86_64 | No support for other distributions or architectures |

These decisions require an explicit architecture review to change.

## Topology

```text
                    approved client CIDRs
                             │
                    ┌────────▼────────┐
                    │    firewalld    │
                    └────────┬────────┘
                             │
              ┌──────────────▼──────────────┐
              │       storage01 (AL10)      │
              │                             │
              │  Elasticsearch   :9200      │
              │  PostgreSQL      :5432      │
              │  MariaDB         :3306      │
              │  Garage S3       :3900      │
              │  Garage admin    :3903      │
              │                             │
              │  internal traffic over      │
              │  loopback / private address │
              └─────────────────────────────┘
```

- All services run on `storage01` in both environments.
- Service listeners bind to loopback by default. Any listener reachable from another host must be explicitly allowed by CIDR and protected by TLS.
- Elasticsearch snapshots and database backups may use Garage over loopback, but Garage on the same host is **not** a disaster-recovery copy. Production requires an off-host backup target.
- There is no high availability. A host loss takes every service down. This is accepted for the current scope and must be revisited before an availability requirement is introduced.

## Repository layout

```text
ansible.cfg                 Controller behavior and default development inventory
requirements.yml            Pinned Ansible collections
requirements-dev.txt        Pinned lint and test tooling
site.yml                    Full host convergence
playbooks/                  Per-role and verification playbooks
roles/                      common, postgresql, and future service roles
inventories/dev/            Development inventory and values
inventories/prod/           Production inventory and values
docker/dev/                 AlmaLinux 10 systemd development image
scripts/                    Developer and policy tooling
docs/                       Normative project documentation
```

## Playbook flow

`site.yml` imports, in order:

1. `common` — baseline OS, access, time, firewall, logging, SELinux
2. `postgresql` — PostgreSQL 18
3. `verify` — service health checks

MariaDB, Garage, and Elasticsearch playbooks will be inserted before verification when their roles land.

Each service playbook targets the `storage` group and runs with `become: true`. Per-role tags allow targeted runs:

```bash
ansible-playbook -i inventories/dev/hosts.yml site.yml --tags postgresql
```

## Component summary

| Component | Role | Default ports | Configuration | Data | Service unit | Source |
|---|---|---|---|---|---|---|
| PostgreSQL 18 | `postgresql` | 5432 | `/var/lib/pgsql/18/data/postgresql.conf` | `/var/lib/pgsql/18/data` | `postgresql-18.service` | PGDG EL10 repository |
| MariaDB 11.8 | planned | 3306 | `/etc/my.cnf.d/` | `/var/lib/mysql` | `mariadb.service` | MariaDB EL10 repository |
| Garage 2.x | planned | 3900 S3, 3901 RPC, 3902 web, 3903 admin | `/etc/garage.toml` | `/var/lib/garage` | `garage.service` | Upstream static binary |
| Elasticsearch 9.x | planned | 9200 HTTP, 9300 transport | `/etc/elasticsearch/` | `/var/lib/elasticsearch` | `elasticsearch.service` | Elastic 9.x repository |

Ports, paths, and package versions are variables. The table records defaults, not hardcoded facts.

See `docs/COMPONENTS.md` for verified source availability and per-component requirements.

## Role contract

Every role must:

- Have `defaults/main.yml`, `handlers/main.yml`, `meta/main.yml`, `meta/argument_specs.yml`, `tasks/main.yml`, and `README.md`.
- Use a role-name prefix on all variables.
- Keep environment data out of the role.
- Validate required variables through `argument_specs`.
- Support check mode, or document why a specific task does not.
- Be idempotent on a second run.
- Include a Molecule scenario under `molecule/default/`.
- Install its own target-side dependencies; it must not assume another service role ran first.
- Use handlers for service restarts.
- Avoid `hostvars` reach-through. Cross-service values belong in inventory variables.

`common` is always applied first in `site.yml`, but each service role must remain independently runnable for testing.

## AlmaLinux 10 baseline

`common` establishes:

- AlmaLinux 10 verification and package installation through `dnf`
- Timezone and optional chrony management
- Admin user creation and optional SSH keys
- SSH hardening through `/etc/ssh/sshd_config.d/99-storage-host.conf`
- firewalld with explicit SSH source CIDRs
- systemd-journald persistent logging
- SELinux enforcement when the target reports SELinux enabled
- Base packages required by later roles (`python3-libselinux`, `policycoreutils-python-utils`, `python3-firewall`, `python3-cryptography`)

Package repositories are configured by the role that needs them. PostgreSQL uses the PGDG repository; MariaDB and Elasticsearch will use their vendor repositories. All repositories require GPG verification.

## Security baseline

- SELinux stays enforcing. Roles add file contexts and port labels rather than disabling enforcement.
- firewalld default-denies inbound traffic. The broad SSH allowance is removed and replaced with source-CIDR rich rules.
- Services bind loopback unless a documented client CIDR requires otherwise.
- TLS is required for every listener reachable off-host.
- Service processes run as dedicated users. Configuration containing credentials is mode `0600` or `0640`.
- Secrets are decrypted on the controller and masked in Ansible output. They are never placed in process arguments or world-readable files.
- SSH host keys are verified. Production uses `known_hosts`; development uses a project-local `known_hosts`.
- Package installation verifies GPG signatures.

## Scope and risks

- **Single point of failure:** one host per environment. Acceptable only with tested backups and a documented recovery objective.
- **Backup locality:** backups stored only on the same host are not disaster recovery. Production needs an off-host target.
- **Container fidelity:** Docker validates packages, templates, services, and idempotence, but not SELinux enforcement, kernel firewall behavior, or real block devices. A real-host smoke test is required before production.
- **Vendor support:** Elasticsearch 9.x repository accessibility is verified, but the RPM install on EL10 must be proven in the role's integration test. Garage is shipped as an upstream binary and requires checksum pinning.
- **No HA:** Elasticsearch runs as a single node, PostgreSQL and MariaDB have no replicas, and Garage has a single-node layout.

## Adding a service

1. Verify the vendor supports AlmaLinux 10 and add the source to `docs/COMPONENTS.md`.
2. Pin the version in both environment `versions.yml` files.
3. Create the role contract and argument specs.
4. Add the Molecule scenario and verification tasks.
5. Add the playbook and import it into `site.yml` before verification.
6. Add firewall, TLS, backup, and restore requirements to the component document.
7. Update `README.md` status and the component table.
