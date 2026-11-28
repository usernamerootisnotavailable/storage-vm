# Architecture

## Purpose

This repository configures a single AlmaLinux 10 host per environment with four storage services:

- Elasticsearch 9 for search and analytics
- PostgreSQL 18 for relational data
- MariaDB 11.8 for relational data
- Garage 2.5 for S3-compatible object storage

The same roles and playbooks run in development and production. Environment differences are confined to inventory, credentials, sizing, endpoints, and capability flags required by the test harness.

## Locked decisions

| Decision | Choice | Consequence |
|---|---|---|
| Secret management | SOPS + age | Encrypted `*.sops.yml` files are committed; age keys never enter the repository |
| Environments | `dev` and `prod` | Identical inventory structure and logical hostnames |
| Topology | One all-in-one host per environment | No clustering or multi-host orchestration |
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
              │  NGINX          :443       │
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
- Service listeners bind loopback by default. Any listener reachable from another host must be explicitly allowed by CIDR and protected by TLS.
- NGINX terminates TLS on port 443 for Elasticsearch and Garage S3. Port 443 is restricted to private/VPN CIDRs.
- Garage has no native TLS. Its S3, admin, and RPC listeners remain loopback-only; NGINX provides the external S3 TLS endpoint.
- Elasticsearch snapshots are written to Garage over loopback and do not depend on NGINX.
- There is no high availability. A host loss takes every service down. Production requires tested off-host backups.

## Repository layout

```text
ansible.cfg                 Controller behavior; no default inventory
requirements.yml            Pinned Ansible collections
requirements-dev.txt        Pinned lint and test tooling
site.yml                    Full host convergence
playbooks/                  Per-role and verification playbooks
roles/                      common, postgresql, mariadb, garage, elasticsearch, nginx
inventories/dev/            Development inventory and encrypted environment files
inventories/prod/           Production inventory and encrypted environment files
inventories/ci/             Synthetic plaintext inventory for CI checks
tofu/                       OpenTofu root module and environment-only credentials
docker/dev/                 AlmaLinux 10 systemd development image
scripts/                    Developer, policy, literal, and integration tooling
docs/                       Normative project documentation
```

## Playbook flow

`site.yml` imports, in order:

1. `common` — baseline OS, access, time, firewall, logging, SELinux
2. `postgresql` — PostgreSQL 18
3. `mariadb` — MariaDB 11.8
4. `garage` — Garage S3
5. `elasticsearch` — Elasticsearch 9 and snapshot repository
6. `nginx` — private TLS reverse proxy for Elasticsearch and Garage
7. `verify` — service health checks

Garage must run before Elasticsearch because Elasticsearch registers a Garage snapshot repository. NGINX runs after Elasticsearch so it can copy and trust the Elasticsearch CA.

## VM provisioning

`tofu/` creates one VM per environment from the AL10 base-image template. It
sets the logical VM name, static address, DNS, SSH public key, CPU, memory, and
disk size through cloud-init. The base image supplies the `ansible` account, its
passwordless sudo rule, and the guest agent. Ansible then applies `site.yml`.

OpenTofu state is local and encrypted with a PBKDF2/AES-GCM passphrase from
`tofu/<env>.sops.yml`. Shared VM and placement values live in
`inventories/<env>/group_vars/all/infrastructure.sops.yml`; the Proxmox API
token is read through an ephemeral SOPS resource and never enters state. See
[`docs/TOFU.md`](TOFU.md).

Per-role tags allow targeted runs:

```bash
ansible-playbook -i inventories/dev/hosts.yml site.yml --tags elasticsearch
```

## Component summary

| Component | Role | Default ports | Configuration | Data | Service unit | Source |
|---|---|---|---|---|---|---|
| PostgreSQL 18 | `postgresql` | 5432 | `/var/lib/pgsql/18/data/postgresql.conf` | `/var/lib/pgsql/18/data` | `postgresql-18.service` | PGDG EL10 repository |
| MariaDB 11.8 | `mariadb` | 3306 | `/etc/my.cnf.d/99-storage-host.cnf` | `/var/lib/mysql` | `mariadb.service` | MariaDB EL10 repository |
| Garage 2.5 | `garage` | 3900 S3, 3901 RPC, 3903 admin | `/etc/garage.toml` | `/var/lib/garage` | `garage.service` | Pinned static binary |
| Elasticsearch 9.5 | `elasticsearch` | 9200 HTTP, 9300 transport | `/etc/elasticsearch/elasticsearch.yml` | `/var/lib/elasticsearch` | `elasticsearch.service` | Elastic 9.x repository |
| NGINX 1.26 | `nginx` | 443 HTTPS | `/etc/nginx/` | — | `nginx.service` | AlmaLinux AppStream |
| Certbot 5.10 | `nginx` | — | `/etc/letsencrypt/` | `/etc/letsencrypt/` | `certbot-renew.timer` | PyPI virtualenv |

Ports, paths, and versions are variables. The table records defaults.

See `docs/COMPONENTS.md` for verified source data and per-component requirements.

## Role contract

Every role:

- Has `defaults/main.yml`, `handlers/main.yml`, `meta/main.yml`, `meta/argument_specs.yml`, `tasks/main.yml`, and `README.md`.
- Uses a role-name prefix on all variables.
- Keeps environment data out of the role.
- Validates required variables through `argument_specs`.
- Supports check mode where practical, or documents the limitation.
- Is idempotent on a second run.
- Includes a Molecule scenario under `molecule/default/`.
- Installs its own target-side dependencies.
- Uses handlers for service restarts.
- Avoids `hostvars` reach-through. Cross-service values use the shared inventory contract.

`common` runs first in `site.yml`, but each service role remains independently runnable for testing.

## Shared S3 contract

Garage and Elasticsearch share:

```yaml
storage_s3_endpoint: "http://127.0.0.1:3900"
storage_s3_region: "garage"
storage_s3_bucket: "elasticsearch-snapshots"
storage_s3_access_key: "{{ secret_storage_s3_access_key }}"
storage_s3_secret_key: "{{ secret_storage_s3_secret_key }}"
```

Garage imports the key and creates the bucket. Elasticsearch stores the key in its keystore and registers the bucket as a snapshot repository.

`disable_chunked_encoding` is required for Garage compatibility: Garage 2.5 rejects the AWS SDK's default aws-chunked trailer signatures.

## AlmaLinux 10 baseline

`common` establishes:

- AlmaLinux 10 verification and package installation through `dnf`
- Timezone and optional chrony management
- Admin user creation and optional SSH keys
- Verification that the image-managed `ansible` account, its cloud-init key, and
  its passwordless sudo rule remain intact
- SSH hardening through `/etc/ssh/sshd_config.d/99-storage-host.conf`
- firewalld with explicit SSH source CIDRs
- systemd-journald persistent logging
- SELinux enforcement when the target reports SELinux enabled
- Packages required by later roles

Package repositories are configured by the role that needs them. All vendor repositories require GPG verification or binary checksums.

## Security baseline

- SELinux stays enforcing. MariaDB installs its vendor policy module. Garage and Elasticsearch have no confined domain on AlmaLinux 10 and run unconfined; this is a documented gap.
- NGINX runs in `httpd_t`; TLS files are labeled `httpd_config_t` and upstream ports `http_port_t`.
- firewalld default-denies inbound traffic. The broad SSH allowance is removed and replaced with source-CIDR rich rules. NGINX opens 443 only to private/VPN CIDRs.
- Services bind loopback unless a documented client CIDR requires otherwise.
- TLS is required for every listener reachable off-host. Garage has no native TLS and is fronted by NGINX.
- Let's Encrypt certificates use DNS-01 through Cloudflare; no inbound HTTP challenge is required.
- Service processes run as dedicated users.
- Secrets are decrypted on the controller and masked in Ansible output. They are never placed in process arguments or world-readable files.
- SSH host keys are verified. Production uses `known_hosts`; development uses a project-local `known_hosts`.
- Package installation verifies GPG signatures or pinned checksums.

## Scope and risks

- **Single point of failure:** one host per environment. Acceptable only with tested backups and a documented recovery objective.
- **Backup locality:** backups stored only on the same host are not disaster recovery. Production needs an off-host target for database dumps and Garage data.
- **Garage exposure:** no native TLS. External S3 access goes through NGINX with path-style addressing and compatible AWS SDK checksum settings.
- **SELinux gaps:** Garage and Elasticsearch run unconfined because AlmaLinux 10 has no matching vendor policy. MariaDB keeps enforcing with its vendor module. NGINX's `httpd_t` to upstream port policy requires real-host verification.
- **Certificate dependency:** Let's Encrypt mode requires a Cloudflare-managed domain, a scoped API token, and outbound HTTPS. DNS-01 is not exercised in CI; development uses generated certificates.
- **Container fidelity:** Docker validates packages, templates, services, and idempotence, but not SELinux enforcement, kernel firewall behavior, or real block devices. A real-host smoke test is required before production.
- **Vendor support:** Elasticsearch 9.5.6 and MariaDB 11.8.10 EL10 packages are verified. Molecule and integration exercise package installation and systemd services; SELinux enforcement and firewalld behavior still require a real host.
- **No HA:** Elasticsearch is a single node, PostgreSQL and MariaDB have no replicas, and Garage has a single-node layout.

## Adding a service

1. Verify the vendor supports AlmaLinux 10 and add the source to `docs/COMPONENTS.md`.
2. Pin the version and checksum in both environment `versions.yml` files.
3. Create the role contract and argument specs.
4. Add the Molecule scenario and verification tasks.
5. Add the playbook and import it into `site.yml` before verification.
6. Add firewall, TLS, backup, and restore requirements to the component document.
7. Update `README.md` status and the component table.
