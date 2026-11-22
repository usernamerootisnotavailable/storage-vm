# MariaDB 11.8

## Overview

The `mariadb` role installs MariaDB 11.8 from the vendor EL10 repository, initializes a single server, configures a private CA and TLS, creates the application database and users, and installs a daily logical backup timer.

## Tested platform

- AlmaLinux 10 x86_64
- MariaDB 11.8.10 (`1.el10`)
- `https://mirror.mariadb.org/yum/11.8/rhel/10/x86_64/`

## Layout

| Item | Default |
|---|---|
| Data directory | `/var/lib/mysql` |
| Configuration | `/etc/my.cnf.d/99-storage-host.cnf` |
| Socket | `/var/lib/mysql/mysql.sock` |
| Logs | `/var/log/mariadb` |
| TLS directory | `/var/lib/mysql/tls` |
| Service | `mariadb.service` |
| Port | `3306` |
| User/group | `mysql` / `mysql` |

## Variables

| Variable | Default | Description |
|---|---|---|
| `mariadb_version` | required | Full version from inventory `versions.yml` |
| `mariadb_port` | `3306` | Listener port |
| `mariadb_bind_address` | `127.0.0.1` | `127.0.0.1` or `0.0.0.0` |
| `mariadb_socket` | `/var/lib/mysql/mysql.sock` | Unix socket |
| `mariadb_allowed_cidrs` | `[]` | firewalld source CIDRs |
| `mariadb_manage_firewall` | common firewall setting | Manage firewalld when CIDRs exist |
| `mariadb_app_user` | `app` | Application user |
| `mariadb_app_database` | `appdb` | Application database |
| `mariadb_app_password` | required | Application password from SOPS |
| `mariadb_app_hosts` | `localhost`, `127.0.0.1` | User host patterns |
| `mariadb_max_connections` | `100` | Connection limit |
| `mariadb_innodb_buffer_pool_size` | `256M` | InnoDB buffer pool |
| `mariadb_tls_mode` | `generated` | `generated` or `provided` |
| `mariadb_tls_ca_path` | data dir `tls/ca.crt` | CA certificate |
| `mariadb_tls_cert_path` | data dir `tls/server.crt` | Server certificate |
| `mariadb_tls_key_path` | data dir `tls/server.key` | Server key |
| `mariadb_backup_enabled` | `true` | Install the backup timer |
| `mariadb_backup_dir` | `/var/backups/mariadb` | Local backup directory |
| `mariadb_backup_retention_days` | `7` | Local retention |

## Authentication

- Local root uses the `unix_socket` plugin.
- Anonymous accounts and remote root accounts are removed.
- The test database is removed.
- Application users are created for every host in `mariadb_app_hosts`.
- Every non-localhost application user is created with `REQUIRE SSL`.
- `require_secure_transport` is enabled for the server.

Local Unix-socket connections are treated as secure. TCP application connections must use TLS.

## TLS

Generated mode creates:

- A private CA at `mariadb_tls_ca_path`
- A server key owned by `mysql`
- A server certificate signed by the CA, with SANs for the inventory hostname, localhost, and 127.0.0.1

The CA private key remains root-only. The server reads only the CA certificate, server certificate, and server key.

Provided mode validates that the CA and server certificate are readable by `mysql` and that the key is owned by `mysql` with mode `0600` or `0640`.

## SELinux

The MariaDB server package ships `mariadb.pp`. The role installs it with `semodule`, applies file contexts, and labels non-default ports as `mysqld_port_t`.

The vendor README recommends permissive mode because its policy has limited test coverage. This project keeps SELinux enforcing. A real AlmaLinux 10 host must verify that no denials occur before production.

## Backups

`mariadb-backup.service` runs `mariadb-dump` as root over the Unix socket:

- All databases
- `--single-transaction`
- Routines, events, and triggers
- UTF-8 output
- Gzip compression
- Retention by age

Backups are local. Copy them off-host for disaster recovery.

### Restore outline

1. Stop application writes.
2. Decompress the selected dump.
3. Import it with `mariadb` as root over the socket.
4. Verify application access.
5. Resume writes.

## Verification

The role verifies:

- Service state
- `mariadb-admin ping`
- Application authentication over TLS
- `Ssl_cipher` is non-empty
- TLS file permissions
- Backup timer enablement

## Upgrade

1. Back up all databases.
2. Confirm the target version in the MariaDB EL10 repository.
3. Change `mariadb_version` in both environment version files.
4. Apply during a maintenance window.
5. Verify application access and restore ability.

Major-version upgrades require a separate plan. Do not downgrade a newer MariaDB data directory.

## Troubleshooting

| Symptom | Check |
|---|---|
| Service fails to start | `journalctl -u mariadb`, `/var/log/mariadb/mariadb.log` |
| Root socket login fails | Root plugin, `mysql.user`, socket path |
| Application TLS fails | CA path, certificate SAN, `require_secure_transport`, user `REQUIRE SSL` |
| SELinux denial | `ausearch -m avc -ts recent`, `semodule -l`, file contexts |
| Backup timer does not run | `systemctl list-timers`, `journalctl -u mariadb-backup` |
