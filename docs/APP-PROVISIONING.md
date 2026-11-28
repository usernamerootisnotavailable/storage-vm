# Application provisioning

This document describes the storage-side interface for application
deployments. It lists variable names and privileges only; it does not contain
environment addresses, CIDRs, domains, or credentials.

The reviewed exception to the previous "storage repository is the only writer"
rule is recorded in [Database applications](DATABASES.md#reviewed-provisioner-exception).

## PostgreSQL provisioners

Add one `postgresql_provisioners` entry per application that needs to create
its own roles and databases:

```yaml
postgresql_provisioners:
  - state: present
    name: "<app>-provisioner"
    user: "<app>_provisioner"
    password: "{{ secret_postgresql_<app>_provisioner_password }}"
    cidrs:
      - "<REPLACE_WITH_APP_CIDR>"
    connection_limit: 10
    rotate_password: false
```

Privileges and access:

- role attributes: `LOGIN`, `CREATEDB`, `CREATEROLE`, `NOSUPERUSER`
- no `SUPERUSER`, `REPLICATION`, or `BYPASSRLS`
- HBA access only to the `postgres` database, only over `hostssl`
- source networks limited to the declared `cidrs`
- firewall access derived from the same CIDRs
- connection limit from `connection_limit`
- no access to the application databases as the provisioner

The application deployment may use the credential to create its own role and
database. The application account owns schema objects and object grants. It
must not create superusers, change server configuration, edit HBA, or grant
access to another application. The storage role remains the owner of the
provisioner account, its password, HBA, TLS, and firewall rules.

The provisioner does not render HBA or firewall access for the roles it creates.
TCP access for an application role still comes from a `postgresql_apps` entry.
A role or database created only through the provisioner has no HBA rule and
cannot connect until the storage inventory declares its user, database, and
CIDRs. The provisioner can connect only to the `postgres` database; application
schema objects belong to the application account.

`state: absent` removes HBA and firewall access. The provisioner role and the
objects it created are retained. Remove data manually with a backup and
rollback plan.

The password belongs in
`inventories/<env>/group_vars/all/environment.sops.yml` as
`secret_postgresql_<app>_provisioner_password`. Do not put a plaintext password
in an app repository, a command line, or process arguments.

The PostgreSQL Molecule scenario creates a throwaway role and database through
the provisioner, verifies them, and drops them.

## MariaDB provisioners

Add one `mariadb_provisioners` entry per application that needs to create its
own databases, accounts, and grants:

```yaml
mariadb_provisioners:
  - state: present
    name: "<app>-provisioner"
    user: "<app>_provisioner"
    password: "{{ secret_mariadb_<app>_provisioner_password }}"
    cidrs:
      - "<REPLACE_WITH_APP_CIDR>"
    database_prefix: "<app>"
```

Privileges and access:

- global `CREATE` and `CREATE USER`
- `ALL` with `GRANT OPTION` only on databases matching
  `<database_prefix>%`
- no global `ALL`, global `GRANT OPTION`, `SUPER`, `FILE`, `PROCESS`,
  `SHUTDOWN`, `RELOAD`, or global `DROP`
- `REQUIRE SSL` on every derived account host
- source networks limited to the declared `cidrs`
- firewall access derived from the same CIDRs

`database_prefix` must be lowercase letters and digits only. MariaDB treats
`%` and `_` as grant wildcards, so they are not allowed in the prefix.

The application deployment may use the credential to create databases and
accounts under its prefix and grant privileges on those databases. It must not
grant outside the prefix, create additional provisioners, or change the server,
TLS, HBA, listener, or firewall.

`state: absent` removes global and prefix grants and firewall access. The
account is retained. Remove accounts or data manually with a backup and
rollback plan.

The password belongs in
`inventories/<env>/group_vars/all/environment.sops.yml` as
`secret_mariadb_<app>_provisioner_password`.

The MariaDB Molecule scenario creates a throwaway database, account, and grant
through the provisioner, verifies them, and drops them.

## Elasticsearch app credentials

The Elasticsearch role enables security, HTTPS, transport TLS, and the `elastic`
bootstrap password. It does not create per-app users.

Create an app role and user by hand with the `elastic` credential:

1. Define an index-pattern-scoped role through the `_security/role` API.
2. Create a user through the `_security/user` API with that role and a generated
   password.
3. Verify the app can authenticate and read or write only its intended indices.
4. Store the app password in the application's own secret store, not in this
   repository.

Use `curl --user elastic` so the password is prompted or read from a protected
file, never passed as a process argument. The API calls use the Elasticsearch CA
and the loopback listener. Do not grant `superuser` unless a reviewed exception
is recorded.

## Garage

Garage keys and buckets are manual. See
[Garage runbook](GARAGE-RUNBOOK.md). The admin API stays loopback-only.

## Verification

- The role verification proves provisioner role/account attributes and scoped
  grants.
- Molecule proves a throwaway role/database and account/grant can be created and
  cleaned up.
- The application deployment owns the real network connection, migrations, and
  its own secret store.
