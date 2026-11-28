# mariadb

Installs and configures MariaDB 11.8 from the vendor AlmaLinux 10 repository for
multiple external applications.

## Responsibilities

- Import the MariaDB signing key and configure the EL10 repository
- Install MariaDB server and client
- Initialize the data directory with `unix_socket` root authentication
- Generate a private CA and server certificate, or validate provided TLS files
- Enforce TLS for TCP connections
- Install the vendor SELinux policy and apply file/port labels
- Create application databases, accounts, database grants, and TLS requirements
- Create optional scoped provisioner accounts with prefix-scoped ALL/GRANT
- Derive account hosts from application and provisioner source CIDRs
- Add or remove firewalld rules from application and provisioner CIDRs
- Install a daily logical backup timer
- Verify accounts, databases, grants, and TLS requirements as root

## Interface variables

```yaml
mariadb_version: "11.8.10"
mariadb_apps:
  - state: present
    name: app
    user: app
    password: "{{ secret_mariadb_app_password | mandatory }}"
    databases:
      - appdb
    cidrs:
      - 127.0.0.1/32
```

The version is pinned in `inventories/<env>/group_vars/all/versions.yml`.
Every app password must come from an encrypted SOPS file and be at least 16
characters. The baseline key is `secret_mariadb_app_password`; additional apps
use `secret_mariadb_<name>_password`.

Each app entry requires:

| Field | Description |
|---|---|
| `state` | `present` or `absent`; every entry must set it explicitly |
| `name` | Unique lowercase application name |
| `user` | Unique lowercase MariaDB account name |
| `password` | SOPS-sourced password, at least 16 characters |
| `databases` | Non-empty list of globally unique lowercase database names |
| `cidrs` | Non-empty list of source CIDRs; default routes are forbidden |

There are no extension or connection-limit fields for MariaDB.

## Common overrides

```yaml
mariadb_port: 3306
mariadb_bind_address: "127.0.0.1"
mariadb_tls_mode: generated
mariadb_backup_enabled: true
```

Production should use `mariadb_tls_mode: provided` with CA-issued certificates.

## Account host derivation

`mariadb_host_from_cidr` is a role-local filter:

- IPv4 `/32` becomes the exact address.
- Broader IPv4 CIDRs become the equivalent `network/netmask` account host.
- IPv6 `/128` becomes the exact address.
- Broader IPv6 CIDRs fail because MariaDB account netmask syntax is IPv4-only.

Invalid CIDRs fail with an explicit error. No application account is created for
`localhost` or `%`.

## Application lifecycle

- `state: present` creates or updates the app databases, one account per derived
  host, database-scoped grants, and `REQUIRE SSL`. Re-applying restores full
  database grants.
- `state: absent` removes `mysql.db` grants and firewall access only. The account
  and databases are retained. Data removal is manual.
- Each account receives `ALL` privileges only on the app's databases and no
  global privileges.
- A non-loopback app CIDR requires `mariadb_bind_address: "0.0.0.0"`.
- Do not add raw `GRANT` statements or manual accounts. Extend `mariadb_apps`.

## Provisioner accounts

`mariadb_provisioners` defines optional scoped provisioning accounts for
application pipelines:

```yaml
mariadb_provisioners:
  - state: present
    name: app-provisioner
    user: app_provisioner
    password: "{{ secret_mariadb_app_provisioner_password | mandatory }}"
    cidrs:
      - "<REPLACE_WITH_APP_CIDR>"
    database_prefix: app
```

Each present account receives:

- global `CREATE`, `CREATE USER`, and `GRANT OPTION`
- `ALL` with `GRANT OPTION` only on databases matching `<database_prefix>%`
- `REQUIRE SSL`

It does not receive global `ALL`, `SUPER`, `FILE`,
`PROCESS`, `SHUTDOWN`, `RELOAD`, or global `DROP`. The global `GRANT OPTION`
can only grant privileges the account already holds. `database_prefix` must be
lowercase letters and digits only; `%` and `_` are not allowed because they are
MariaDB grant wildcards.

Absent entries remove global and prefix grants and firewall access only; the
account is retained. Provisioner and application users and names must be
disjoint. See [`docs/APP-PROVISIONING.md`](../../docs/APP-PROVISIONING.md).

## Authentication

- Local root uses the `unix_socket` plugin.
- Anonymous accounts and remote root access are removed.
- Every present app account requires TLS, including loopback sources.
- The role does not authenticate as app users. App deployments verify their own
  connectivity.

## Verification

The role checks:

- Service state and `mariadb-admin ping`
- Every present database exists
- Every present account exists for every derived host
- `mysql.user.ssl_type` is `ANY`, `X509`, or `SPECIFIED`
- Every declared database has a `mysql.db` grant for every derived host
- Present provisioners have global `CREATE`, `CREATE USER`, and `GRANT OPTION`,
  no global `ALL` or administrative privileges, and a prefix-scoped `ALL/GRANT`
  row
- Absent apps and provisioners have no database or prefix grants
- TLS file permissions
- Backup timer enablement

## Notes

- MariaDB ships an SELinux policy module. The role installs it and keeps SELinux
  enforcing; the vendor README recommends permissive, but production validation
  must use enforcing mode.
- Local backups are not off-host backups. Copy `mariadb_backup_dir` to a separate
  system.
- The `require_secure_transport` setting remains enabled.
- The role does not drop accounts or databases for `state: absent`.
