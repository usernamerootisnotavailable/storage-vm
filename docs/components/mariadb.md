# MariaDB 11.8

## Overview

The `mariadb` role installs MariaDB 11.8 from the vendor EL10 repository,
initializes a single server, configures a private CA and TLS, creates multiple
external application accounts, databases, and grants, and installs a daily
logical backup timer. Application deployments own migrations and connectivity.
The storage host never connects as an application user during role execution.

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
| `mariadb_bind_address` | `127.0.0.1` | `127.0.0.1` or `0.0.0.0`; must be reachable when non-loopback app CIDRs exist |
| `mariadb_socket` | `/var/lib/mysql/mysql.sock` | Unix socket |
| `mariadb_manage_firewall` | common firewall setting | Manage firewalld when app CIDRs exist |
| `mariadb_apps` | `[]` | External applications; each entry is defined below |
| `mariadb_max_connections` | `100` | Connection limit |
| `mariadb_innodb_buffer_pool_size` | `256M` | InnoDB buffer pool |
| `mariadb_tls_mode` | `generated` | `generated` or `provided` |
| `mariadb_tls_ca_path` | data dir `tls/ca.crt` | CA certificate |
| `mariadb_tls_cert_path` | data dir `tls/server.crt` | Server certificate |
| `mariadb_tls_key_path` | data dir `tls/server.key` | Server key |
| `mariadb_backup_enabled` | `true` | Install the backup timer |
| `mariadb_backup_dir` | `/var/backups/mariadb` | Local backup directory |
| `mariadb_backup_retention_days` | `7` | Local retention |

Each `mariadb_apps` entry has:

| Field | Default | Description |
|---|---|---|
| `state` | required | `present` or `absent` |
| `name` | required | Unique lowercase application name |
| `user` | required | Unique lowercase MariaDB account name |
| `password` | required | SOPS-sourced password of at least 16 characters |
| `databases` | required | Non-empty list of globally unique lowercase database names |
| `cidrs` | required | Non-empty list of source CIDRs; `0.0.0.0/0` and `::/0` are forbidden |

The full interface is validated by `roles/mariadb/meta/argument_specs.yml`. Role
tasks validate state values, identifiers, uniqueness, non-empty databases and
CIDRs, CIDR syntax, password length, reserved account names, and system database
names. Validation output redacts passwords. There are no extensions or
connection-limit fields for MariaDB.

## Account hosts from CIDRs

Accounts are created per application and per derived client host, not for
`localhost` or a wildcard host.

- IPv4 `/32` becomes the exact address, for example `127.0.0.1/32` becomes
  `127.0.0.1`.
- A broader IPv4 CIDR becomes the equivalent `network/netmask` account host.
- IPv6 `/128` becomes the exact address.
- Broader IPv6 CIDRs fail because MariaDB account netmask syntax is IPv4-only.
  Use exact IPv6 `/128` source addresses or an IPv4 CIDR.

The conversion is implemented by the role-local
`mariadb_host_from_cidr` filter. Invalid CIDRs fail with an explicit error.

## Authentication and grants

- Local root uses the `unix_socket` plugin.
- Anonymous accounts and remote root accounts are removed.
- The test database is removed.
- Each present app gets one account per derived host.
- Each account receives `ALL` privileges only on its own app databases. Global
  privileges are not granted.
- Every app account is created with `REQUIRE SSL`; MariaDB has no equivalent of
  `pg_hba.conf`, so TLS is enforced on the account itself in addition to
  `require_secure_transport`.
- Verification reads `mysql.user.ssl_type` and requires `ANY`, `X509`, or
  `SPECIFIED`. Module intent alone is not trusted.
- The role does not authenticate as application users. App deployments verify
  their own connectivity.

## TLS

Generated mode creates:

- A private CA at `mariadb_tls_ca_path`
- A server key owned by `mysql`
- A server certificate signed by the CA, with SANs for the inventory hostname,
  localhost, and 127.0.0.1

The CA private key remains root-only. The server reads only the CA certificate,
server certificate, and server key.

Provided mode validates that the CA and server certificate are readable by
`mysql` and that the key is owned by `mysql` with mode `0600` or `0640`.

Application deployments must trust the issuing CA. The development CA is
`/var/lib/mysql/tls/ca.crt`; production should use an organization CA and
distribute only its certificate to clients. Every app account requires TLS even
for loopback sources.

## Firewall

- No port is opened unless the union of present app CIDRs is non-empty.
- Present app CIDRs receive firewalld rich rules for `mariadb_port`.
- CIDRs used only by absent apps have their MariaDB rich rules removed.
- Non-loopback app CIDRs require `mariadb_bind_address: "0.0.0.0"`.
- A non-loopback listener without firewall management is an explicit
  deployment choice; do not add ad hoc port openings outside `mariadb_apps`.

## SELinux

The MariaDB server package ships `mariadb.pp`. The role installs it with
`semodule`, applies file contexts, and labels non-default ports as
`mysqld_port_t`.

The vendor README recommends permissive mode because its policy has limited test
coverage. This project keeps SELinux enforcing. A real AlmaLinux 10 host must
verify that no denials occur before production.

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

- Service state and `mariadb-admin ping`
- Each present database exists
- Each present account exists for every derived host
- Each account requires SSL according to `mysql.user.ssl_type`
- Each account has a `mysql.db` grant for every declared database and host
- Absent accounts have no `mysql.db` grants for their declared databases and
  hosts
- TLS file permissions
- Backup timer enablement

The role does not connect as app users and does not drop accounts or data.

## Adding a MariaDB app

See [`docs/DATABASES.md`](../DATABASES.md) for the cross-engine policy on
ownership, lifecycle, secrets, network exposure, TLS, and verification.

1. Add one `mariadb_apps` entry with an explicit `state`, unique lowercase
   `name` and `user`, and globally unique `databases`.
2. Store the password in SOPS under a distinct key. The baseline app uses
   `secret_mariadb_app_password`; additional apps use
   `secret_mariadb_<name>_password`. Map it into the entry's `password` and
   never reuse a password.
3. Set `cidrs` to the exact Kubernetes egress or private source networks. Do not
   use `0.0.0.0/0` or `::/0`. Account hosts are derived from these CIDRs: exact
   IPv4 `/32` or IPv6 `/128` addresses, or IPv4 `network/netmask` for broader
   IPv4 networks. Broader IPv6 CIDRs are rejected.
4. Every app account uses `REQUIRE SSL`. Configure the app to verify the server
   certificate against the MariaDB CA and use the hostname or IP address covered
   by the certificate SANs. Loopback development may use the generated CA;
   production should use the organization CA.
5. Set `mariadb_bind_address` and the app CIDRs together. A non-loopback CIDR
   requires `0.0.0.0`; loopback-only listeners cannot accept external apps.
   Firewall rules come from the union of present app CIDRs. Do not add raw
   port openings.
6. Do not add raw `GRANT` statements or manual accounts. Extend `mariadb_apps`
   instead; the role owns accounts, databases, grants, and TLS requirements.
7. Databases are created empty with the configured encoding and collation. The
   app deployment owns schema migrations, runtime object grants, and
   connectivity verification.
8. To remove access, set `state: absent` and apply the role. This removes
   `mysql.db` grants for the declared databases and derived hosts, and firewall
   exposure for CIDRs used only by absent apps. The account and databases are
   retained and may remain with no database privileges. Data removal is a
   separate manual operation with a backup and rollback plan.
9. To rotate a password, update SOPS and apply the role. Re-applying a present
   app also restores its full database grants.

## Upgrade

1. Back up all databases.
2. Confirm the target version in the MariaDB EL10 repository.
3. Change `mariadb_version` in both environment version files.
4. Apply during a maintenance window.
5. Verify application access and restore ability.

Major-version upgrades require a separate plan. Do not downgrade a newer
MariaDB data directory.

## Troubleshooting

| Symptom | Check |
|---|---|
| Service fails to start | `journalctl -u mariadb`, `/var/log/mariadb/mariadb.log` |
| Root socket login fails | Root plugin, `mysql.user`, socket path |
| Application TLS fails | CA path, certificate SAN, `require_secure_transport`, `mysql.user.ssl_type` |
| Application host rejected | Derived account host, CIDR netmask, `skip-name-resolve` |
| Application lacks database access | `mysql.db` grants for the derived host and declared databases |
| SELinux denial | `ausearch -m avc -ts recent`, `semodule -l`, file contexts |
| Backup timer does not run | `systemctl list-timers`, `journalctl -u mariadb-backup` |
