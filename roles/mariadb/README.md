# mariadb

Installs and configures MariaDB 11.8 from the vendor AlmaLinux 10 repository.

## Responsibilities

- Import the MariaDB signing key and configure the EL10 repository
- Install MariaDB server and client
- Initialize the data directory with `unix_socket` root authentication
- Generate a private CA and server certificate, or validate provided TLS files
- Enforce TLS for TCP connections
- Install the vendor SELinux policy and apply file/port labels
- Create the application database and users
- Add firewalld rules for approved client CIDRs
- Install a daily logical backup timer
- Verify an authenticated TLS connection

## Required variables

```yaml
mariadb_version: "11.8.10"
mariadb_app_password: "{{ secret_mariadb_app_password }}"
```

The version is pinned in `inventories/<env>/group_vars/storage/versions.yml`.
The password must come from an encrypted SOPS file.

## Common overrides

```yaml
mariadb_port: 3306
mariadb_bind_address: "127.0.0.1"
mariadb_allowed_cidrs: []
mariadb_tls_mode: generated
mariadb_app_user: app
mariadb_app_database: appdb
mariadb_backup_enabled: true
```

Production should use `mariadb_tls_mode: provided` with CA-issued certificates.

## Authentication

- Local root uses the `unix_socket` plugin.
- Anonymous accounts and remote root access are removed.
- Application users are created for each entry in `mariadb_app_hosts`.
- Every non-localhost application user requires TLS.

## Notes

- MariaDB ships an SELinux policy module. The role installs it and keeps SELinux enforcing; the vendor README recommends permissive, but production validation must use enforcing mode.
- Local backups are not off-host backups. Copy `mariadb_backup_dir` to a separate system.
- The `require_secure_transport` setting remains enabled.
