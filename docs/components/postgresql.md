# PostgreSQL 18

## Overview

The `postgresql` role installs PostgreSQL 18 from the PGDG EL10 repository, initializes a single cluster, configures TLS and SCRAM authentication, creates one application user and database, optionally installs a daily backup timer, and verifies an authenticated TLS connection.

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
| `postgresql_listen_addresses` | `"127.0.0.1"` | Listener addresses; must be reachable when external CIDRs are allowed |
| `postgresql_allowed_cidrs` | `[]` | Client CIDRs allowed through firewalld |
| `postgresql_manage_firewall` | `common_firewall_enabled` | Add firewall rules when CIDRs are configured |
| `postgresql_max_connections` | `100` | Maximum connections |
| `postgresql_shared_buffers` | `"256MB"` | Shared buffer size |
| `postgresql_effective_cache_size` | `"768MB"` | Planner cache estimate |
| `postgresql_maintenance_work_mem` | `"64MB"` | Maintenance memory |
| `postgresql_work_mem` | `"4MB"` | Per-operation memory |
| `postgresql_wal_level` | `"replica"` | WAL level |
| `postgresql_password_encryption` | `"scram-sha-256"` | Password hashing |
| `postgresql_app_user` | `"app"` | Application role |
| `postgresql_app_database` | `"appdb"` | Application database |
| `postgresql_app_password` | required | Application password from SOPS |
| `postgresql_rotate_passwords` | `false` | Allow password changes on an existing role |
| `postgresql_tls_enabled` | `true` | Enable TLS |
| `postgresql_tls_mode` | `"generated"` | `generated` self-signed or `provided` |
| `postgresql_tls_common_name` | `inventory_hostname` | Generated certificate CN |
| `postgresql_tls_sans` | host name, localhost, 127.0.0.1 | Generated certificate SANs |
| `postgresql_backup_enabled` | `true` | Install the backup timer |
| `postgresql_backup_dir` | `/var/backups/postgresql` | Local backup directory |
| `postgresql_backup_retention_days` | `7` | Local retention |
| `postgresql_backup_on_calendar` | `*-*-* 02:15:00` | systemd timer schedule |
| `postgresql_extra_hba_entries` | `[]` | Additional raw `pg_hba.conf` lines |

The full interface is validated by `roles/postgresql/meta/argument_specs.yml`.

## Authentication

- Local Unix-socket connections use peer authentication.
- TCP connections use SCRAM-SHA-256.
- TLS is enabled by default. `pg_hba.conf` uses `hostssl` entries when TLS is enabled.
- The application user owns the application database.
- Administrative Ansible modules run as the `postgres` OS user over the local socket.

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

- `pg_isready` succeeds
- The service is active and enabled
- The application database exists and is owned by the application user
- The application user can authenticate over TCP
- The session uses TLS when TLS is enabled
- Configuration files pass `postgres -C` validation

## Firewall and SELinux

- No port is opened unless `postgresql_allowed_cidrs` is non-empty.
- Allowed CIDRs receive firewalld rich rules for the configured port.
- When the port is not 5432, SELinux gets a `postgresql_port_t` label.
- The data directory receives `postgresql_db_t`, and the log directory receives `postgresql_log_t`.
- SELinux tasks are skipped only when `getenforce` reports `Disabled`.

Docker tests cannot verify these controls. A real AlmaLinux 10 host check is required for firewall or SELinux changes.

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
| Application cannot connect | `postgresql_listen_addresses`, `postgresql_allowed_cidrs`, firewalld rich rules |
| TLS handshake fails | Certificate paths, key permissions, SANs, `ssl = on` |
| SELinux denial | `ausearch -m avc -ts recent`, file contexts, port label |
| Backup timer does not run | `systemctl list-timers`, `journalctl -u postgresql-backup` |
