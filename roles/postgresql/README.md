# postgresql

Installs and configures PostgreSQL 18 from the PGDG AlmaLinux 10 repository for
multiple external applications.

## Responsibilities

- Import the PGDG GPG key and configure the repository
- Install PostgreSQL 18 and the Python client library
- Initialize the cluster with UTF-8 encoding
- Generate or validate TLS certificates
- Configure `postgresql.conf` and `pg_hba.conf`
- Apply SELinux contexts and port labels
- Create application roles, databases, and requested extensions with SCRAM
  authentication
- Add firewalld rules for the union of present application CIDRs
- Install a daily logical backup timer
- Verify service health, HBA rules, roles, databases, extensions, and TLS

## Interface variables

```yaml
postgresql_version: "18"
postgresql_apps:
  - state: present
    name: app
    user: app
    password: "{{ secret_postgresql_app_password | mandatory }}"
    databases:
      - appdb
    cidrs:
      - 127.0.0.1/32
    extensions: []
    connection_limit: 100
    rotate_password: false
```

The version is pinned in `inventories/<env>/group_vars/all/versions.yml`.
Every app password must come from an encrypted SOPS file and be at least 16
characters.

Each app entry requires:

| Field | Description |
|---|---|
| `state` | `present` or `absent`; every entry must set it explicitly |
| `name` | Unique lowercase application name |
| `user` | Unique lowercase PostgreSQL role name |
| `password` | SOPS-sourced password, at least 16 characters |
| `databases` | Non-empty list of unique lowercase database names |
| `cidrs` | Non-empty list of source CIDRs; default routes are forbidden |
| `extensions` | Optional extension list, default `[]` |
| `connection_limit` | Optional role connection limit, default `-1` |
| `rotate_password` | Optional password rotation flag, default `false` |

## Common overrides

```yaml
postgresql_port: 5432
postgresql_listen_addresses: "127.0.0.1"
postgresql_tls_mode: generated
postgresql_backup_enabled: true
```

Production should use `postgresql_tls_mode: provided` with CA-issued
certificates.

## Application lifecycle

- `state: present` creates or updates the role, its databases, and requested
  extensions, and renders HBA and firewall access for its CIDRs.
- `state: absent` removes HBA and firewall access only. The role and databases
  are retained. Data removal is manual.
- `rotate_password: true` allows the password of an existing role to be
  updated; return it to `false` after the rotation run.
- The storage role creates empty databases and extensions. Application
  deployments own schema migrations and runtime object grants.
- A non-loopback app CIDR requires TLS and a non-loopback
  `postgresql_listen_addresses` value.
- Do not add raw `pg_hba.conf` entries. Extend `postgresql_apps` instead.

## Example

```yaml
- hosts: storage
  become: true
  roles:
    - role: postgresql
```

## Verification

The role checks:

- Service state and `pg_isready`
- `pg_hba_file_rules` parse errors and absence of broad host rules
- Present role attributes and connection limits
- Present database existence and ownership
- Requested extensions in each database
- The running TLS setting and TLS file permissions
- Absent apps have no HBA access
- Backup timer enablement

It does not connect as application users. External applications are verified by
their own deployments.

## Notes

- Local backups are not off-host backups. Copy `postgresql_backup_dir` to a
  separate system.
- SELinux and firewalld behavior must be verified on a real AlmaLinux 10 host.
