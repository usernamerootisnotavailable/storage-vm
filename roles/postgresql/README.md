# postgresql

Installs and configures PostgreSQL 18 from the PGDG AlmaLinux 10 repository.

## Responsibilities

- Import the PGDG GPG key and configure the repository
- Install PostgreSQL 18 and the Python client library
- Initialize the cluster with UTF-8 encoding
- Generate or validate TLS certificates
- Configure `postgresql.conf` and `pg_hba.conf`
- Apply SELinux contexts and port labels
- Create an application role and database with SCRAM authentication
- Add firewalld rules for approved client CIDRs
- Install a daily logical backup timer
- Verify an authenticated TLS connection

## Required variables

```yaml
postgresql_version: "18"
postgresql_app_password: "{{ secret_postgresql_app_password }}"
```

The version is pinned in `inventories/<env>/group_vars/storage/versions.yml`.
The password must come from an encrypted SOPS file.

## Common overrides

```yaml
postgresql_port: 5432
postgresql_listen_addresses: "127.0.0.1"
postgresql_allowed_cidrs: []
postgresql_tls_mode: generated
postgresql_app_user: app
postgresql_app_database: appdb
postgresql_backup_enabled: true
```

Production should use `postgresql_tls_mode: provided` with CA-issued certificates.

## Example

```yaml
- hosts: storage
  become: true
  roles:
    - role: postgresql
```

## Verification

The role checks:

- Service state
- `pg_isready`
- Application authentication over TCP
- TLS usage
- Database owner
- TLS file permissions
- Backup timer enablement

## Notes

- Passwords are not changed on existing roles unless `postgresql_rotate_passwords` is true.
- Local backups are not off-host backups. Copy `postgresql_backup_dir` to a separate system.
- SELinux and firewalld behavior must be verified on a real AlmaLinux 10 host.
