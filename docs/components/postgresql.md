# PostgreSQL 18

## Overview

The `postgresql` role installs PostgreSQL 18 from the PGDG EL10 repository, initializes a single cluster, configures TLS and SCRAM authentication, creates multiple external application roles, databases, and extensions, optionally installs a daily backup timer, and verifies the resulting access configuration. Application deployments own migrations and are verified by their own deployment pipelines.

## Tested platform

- AlmaLinux 10 x86_64
- PostgreSQL 18.7 (`postgresql18-server-18.7-1PGDG.rhel10.3.x86_64`)
- PGDG EL10 repository

## Layout

| Item | Default |
|---|---|
| Data directory | `/var/lib/pgsql/18/data` |
| Configuration | `/var/lib/pgsql/18/data/postgresql.conf` |
| Host-based auth | `/var/lib/pgsql/18/data/pg_hba.conf` |
| TLS directory | `/var/lib/pgsql/18/data/tls` |
| Socket directory | `/run/postgresql` |
| Service | `postgresql-18.service` |
| Port | `5432` |
| User/group | `postgres` / `postgres` |

## Variables

| Variable | Default | Description |
|---|---|---|
| `postgresql_version` | required | Pinned major version from inventory `versions.yml` |
| `postgresql_port` | `5432` | Listener port |
| `postgresql_listen_addresses` | `"127.0.0.1"` | Listener addresses; must be reachable when non-loopback app CIDRs exist |
| `postgresql_apps` | `[]` | External applications; each entry is defined below |
| `postgresql_manage_firewall` | `common_firewall_enabled` | Add firewall rules for the union of present app CIDRs |
| `postgresql_max_connections` | `100` | Maximum connections |
| `postgresql_shared_buffers` | `"256MB"` | Shared buffer size |
| `postgresql_effective_cache_size` | `"768MB"` | Planner cache estimate |
| `postgresql_maintenance_work_mem` | `"64MB"` | Maintenance memory |
| `postgresql_work_mem` | `"4MB"` | Per-operation memory |
| `postgresql_wal_level` | `"replica"` | WAL level |
| `postgresql_password_encryption` | `"scram-sha-256"` | Password hashing |
| `postgresql_tls_enabled` | `true` | Enable TLS |
| `postgresql_tls_mode` | `"generated"` | `generated` self-signed or `provided` |
| `postgresql_tls_common_name` | `inventory_hostname` | Generated certificate CN |
| `postgresql_tls_sans` | host name, localhost, 127.0.0.1 | Generated certificate SANs |
| `postgresql_backup_enabled` | `true` | Install the backup timer |
| `postgresql_backup_dir` | `/var/backups/postgresql` | Local backup directory |
| `postgresql_backup_retention_days` | `7` | Local retention |
| `postgresql_backup_on_calendar` | `*-*-* 02:15:00` | systemd timer schedule |

Each `postgresql_apps` entry has:

| Field | Default | Description |
|---|---|---|
| `state` | required | `present` or `absent` |
| `name` | required | Unique lowercase application name |
| `user` | required | Unique lowercase PostgreSQL role |
| `password` | required | SOPS-sourced password of at least 16 characters |
| `databases` | required | Non-empty list of globally unique lowercase database names |
| `cidrs` | required | Non-empty list of source CIDRs; `0.0.0.0/0` and `::/0` are forbidden |
| `extensions` | `[]` | Extensions created in every database for the app |
| `connection_limit` | `-1` | Role connection limit, at least `-1` |
| `rotate_password` | `false` | Allow updating an existing role password |

The full interface is validated by `roles/postgresql/meta/argument_specs.yml`.
Role tasks validate state values, identifiers, uniqueness, CIDR syntax,
password length, extension names, and connection limits.

## Authentication

- Local Unix-socket connections use peer authentication, including the
  `postgres` administrator.
- TCP connections use SCRAM-SHA-256.
- TLS is enabled by default. `pg_hba.conf` uses `hostssl` entries per present
  app database, user, and CIDR when TLS is enabled, and `host` entries only for
  loopback apps when TLS is disabled.
- Broad `hostssl all all` rules are not rendered.
- Each application role owns its databases.
- Administrative Ansible modules run as the `postgres` OS user over the local socket.
- The role does not connect as application users; app deployments verify their
  own connectivity.

The `postgres` superuser does not receive a password. Administrative access is through peer authentication on the host.

## TLS

### Generated mode

The role creates a private key, CSR, and self-signed certificate under `/var/lib/pgsql/18/data/tls` using `community.crypto`.

- Key: `0600`, owned by `postgres:postgres`
- Certificate: `0644`, owned by `postgres:postgres`
- SANs include the inventory hostname, `localhost`, and `127.0.0.1`
- Validity: 825 days

Generated certificates are appropriate for development and internal bootstrapping. Production should use a certificate issued by the organization's CA.

### Provided mode

Set:

```yaml
postgresql_tls_mode: provided
postgresql_tls_cert_path: /var/lib/pgsql/18/data/tls/server.crt
postgresql_tls_key_path: /var/lib/pgsql/18/data/tls/server.key
```

The role verifies that both files exist, are owned by `postgres:postgres`, and that the key is mode `0600` or `0640`. Certificate provisioning and SELinux labeling are the operator's responsibility when the files live outside the default data directory. Do not store private keys in inventory or SOPS if they can be issued on the host or delivered by a certificate management system.

Any present app with a non-loopback CIDR requires TLS. The certificate SANs
must cover the hostname or IP address the apps use, and application deployments
must trust the issuing CA. Generated self-signed certificates are appropriate
only for development and loopback integration checks.

## Backups

When `postgresql_backup_enabled` is true, the role installs:

- `/usr/local/sbin/postgresql-backup`
- `postgresql-backup.service`
- `postgresql-backup.timer`

The script runs as `postgres`, dumps all databases with `pg_dumpall`, compresses the output, and removes files older than the retention period.

Backups are written to `postgresql_backup_dir`. On the all-in-one host, this directory is not an off-host backup. Production must copy backups to a separate system or storage target.

### Restore outline

1. Stop application writes.
2. Restore the chosen dump with `psql` as `postgres`.
3. Verify roles, databases, and ownership.
4. Run the role's verification tasks.
5. Resume writes.

Test the restore procedure before relying on it.

## Verification

The role verifies:

- The service is running and `pg_isready` succeeds
- `pg_hba_file_rules` reports no parse errors or broad host rules
- Each present app role exists with `LOGIN`, without `SUPERUSER`, `CREATEDB`, or
  `CREATEROLE`, and with the expected connection limit
- Each present app database exists and is owned by its app user
- Requested extensions exist in each present app database
- Absent apps have no rendered HBA access rule; retained data does not fail
- The running `ssl` setting matches `postgresql_tls_enabled`, and TLS files have
  safe permissions
- Configuration files pass `postgres -C` validation
- The backup timer is enabled

The role does not authenticate as app users. The integration playbook proves
development app logins over `127.0.0.1` with TLS.

## Firewall and SELinux

- No port is opened unless the union of present app CIDRs is non-empty.
- Present app CIDRs receive firewalld rich rules for the configured port.
- CIDRs used only by absent apps have their PostgreSQL rich rules removed.
- Non-loopback app CIDRs require a reachable listener and TLS.
- When the port is not 5432, SELinux gets a `postgresql_port_t` label.
- The data directory receives `postgresql_db_t`, and the log directory receives `postgresql_log_t`.
- SELinux tasks are skipped only when `getenforce` reports `Disabled`.

Docker tests cannot verify these controls. A real AlmaLinux 10 host check is required for firewall or SELinux changes.

## Adding a PostgreSQL app

1. Add one `postgresql_apps` entry with an explicit `state`, unique lowercase
   `name` and `user`, and globally unique `databases`.
2. Store the password in SOPS under a distinct key. The baseline key is
   `secret_postgresql_app_password`; additional apps use
   `secret_postgresql_<name>_password`. Map it into the entry's `password`
   and never reuse a password.
3. Set `cidrs` to the exact Kubernetes egress or private source networks. Do
   not use `0.0.0.0/0` or `::/0`. Any non-loopback CIDR requires TLS, a
   reachable `postgresql_listen_addresses`, and clients that trust the
   certificate CA.
4. Set `postgresql_listen_addresses` and the app CIDRs together. Firewall rules
   are derived from the union of present app CIDRs; do not add ad hoc port
   openings.
5. Do not add raw HBA lines. `pg_hba.conf` is generated from present apps plus
   local peer administration only.
6. Databases are created empty and owned by the app user. The app deployment
   owns schema migrations, runtime grants, and connectivity verification.
7. To remove access, set `state: absent` and apply the role. This removes HBA
   and firewall exposure without dropping the role or databases. Data removal
   is a separate manual operation with a backup and rollback plan.
8. To rotate a password, update SOPS, set `rotate_password: true` on that app
   only, apply the role, verify the app, then return the flag to `false`.

## Upgrade

Major-version upgrades are not automated. For a minor upgrade:

1. Back up the cluster.
2. Confirm the target package version in the PGDG repository.
3. Apply the role with `postgresql_package_state: present`.
4. Verify the service and application connection.
5. Keep the previous backup until the new version is proven.

For a major upgrade, use `pg_upgrade` in a separate, documented change. Do not change `postgresql_version` in place without an upgrade plan.

## Troubleshooting

| Symptom | Check |
|---|---|
| Service fails to start | `journalctl -u postgresql-18`, `postgres -C` config validation |
| `psql` peer authentication fails | Run as the `postgres` OS user; check `pg_hba.conf` local rules |
| Application cannot connect | `postgresql_apps` CIDRs, `postgresql_listen_addresses`, TLS mode, firewalld rich rules |
| TLS handshake fails | Certificate paths, key permissions, SANs, `ssl = on` |
| SELinux denial | `ausearch -m avc -ts recent`, file contexts, port label |
| Backup timer does not run | `systemctl list-timers`, `journalctl -u postgresql-backup` |
