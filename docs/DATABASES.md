# Database applications

This document is the normative cross-engine policy for adding or removing an
application that uses PostgreSQL 18 or MariaDB 11.8 on the storage host. It
applies to application deployments outside this repository. Engine mechanics
remain in [PostgreSQL 18](components/postgresql.md) and
[MariaDB 11.8](components/mariadb.md); variable and secret rules remain in
[Variables](VARIABLES.md) and [Secrets](SECRETS.md).

Read this policy before changing `postgresql_apps` or `mariadb_apps`.

## Ownership boundary

Database access has one owner: this repository. Application deployments are
clients. They may use a scoped provisioner account for their own roles,
databases, and grants, subject to the reviewed exception below. They are never
database administrators.

| Area | Storage repository owns | Application deployment owns |
|---|---|---|
| Inventory contract | The `postgresql_apps`, `mariadb_apps`, `postgresql_provisioners`, or `mariadb_provisioners` entry, including engine, names, prefixes, databases, CIDRs, and state | Its own deployment configuration and application schema |
| Identity | Roles, accounts, passwords, database ownership, database grants, provisioner scope, and reserved-name enforcement | Schema migrations, object ownership inside its databases, and runtime object grants permitted to its account |
| Provisioning | Provisioner account credentials, global privileges, prefix scope, HBA or account hosts, TLS requirements, and firewall exposure | Creating or dropping only its own scoped roles, databases, and grants through the provisioner account |
| Authentication | `pg_hba.conf`, MariaDB account hosts, TLS requirements, listener addresses, and database firewall rules | Connecting from the declared source network and verifying the server certificate |
| Secrets | The encrypted database password and its mapping into the app or provisioner entry | Consuming the matching credential through the application's own secret store |
| Verification | Role/account, database, extension, HBA, grant or ownership, and TLS verification as the database administrator | A real connection from the application network, migrations, and application health |

Database-level grants and account privileges belong to the storage repository.
Application migrations may create objects and the object grants needed by their
own account inside the application's databases. They must not change the
provisioner scope, grant access outside the declared database prefix, or change
database-level access outside the provisioner contract.

Application pipelines must never, outside the scoped provisioner exception:

- Receive or use a PostgreSQL superuser, MariaDB `root`, or any other
  administrative credential.
- Create, alter, or drop roles, users, databases, or database-level access
  grants directly.
- Edit `pg_hba.conf`, `mysql.user`, `mysql.db`, or other authentication tables.
- Add a database firewall rule manually or open the database port directly.
- Change the database listener, TLS files, or CA trust on the storage host.

A reviewed manual decommission after `state: absent` is a storage operation, not
an application pipeline operation. It is covered in
[Decommissioning data](#decommissioning-data).

### Reviewed provisioner exception

This is the reviewed exception to the former "storage repository is the only
writer" rule. It exists because application deployments need to create their own
database identities during bootstrap without receiving a superuser or database
administrator credential.

PostgreSQL provisioners:

- are declared in `postgresql_provisioners`
- have exactly `LOGIN`, `CREATEDB`, `CREATEROLE`, and `NOSUPERUSER`
- may connect only to the `postgres` database over TLS
- may create roles and databases, but cannot create superusers, change server
  configuration, or bypass TLS
- lose HBA and firewall access on `state: absent`; their role and created objects
  are retained

MariaDB provisioners:

- are declared in `mariadb_provisioners`
- receive global `CREATE` and `CREATE USER`
- receive `ALL` with `GRANT OPTION` only on databases matching
  `<database_prefix>%`
- do not receive global `ALL`, global `GRANT OPTION`, `SUPER`, `FILE`,
  `PROCESS`, `SHUTDOWN`, `RELOAD`, or global `DROP`
- require SSL
- lose global and prefix grants and firewall access on `state: absent`; the
  account is retained

The storage repository still owns the provisioner account, its password, its
scope, its TLS and network exposure, and its verification. Application
deployments may use only the provisioner credential issued to them. They must
not grant outside the prefix, create additional provisioners, or modify the
storage host. See [Application provisioning](APP-PROVISIONING.md).

## Engine choice

Choose exactly one outcome for every application:

| Outcome | When to use it | Inventory contract |
|---|---|---|
| PostgreSQL | The application supports PostgreSQL and can use its features | Add one `postgresql_apps` entry |
| MariaDB | The application supports MariaDB or the MySQL protocol | Add one `mariadb_apps` entry |
| No managed database | The application uses SQLite, an embedded database, or a database managed outside this host | Add no database entry |

Rules:

- Do not create an entry for an application that does not use PostgreSQL or
  MariaDB. A future possibility is not a reason to provision a database.
- Do not create both entries for one application unless the application
  genuinely requires both engines for separate data.
- If the application supports both engines, choose one, record the reason in the
  pull request, and keep the unused engine free of placeholder accounts and
  databases.
- PostgreSQL-only capabilities are `extensions` and `connection_limit`. Use
  PostgreSQL when the application requires them.
- MariaDB has no extension or per-app connection-limit field. Do not add one to
  inventory and do not simulate it with extra accounts or grants.
- "No managed database" is a valid choice. Do not create a local database just
  to standardize an application that does not need one.

## Application interfaces

One entry represents one external application. It has exactly one `name`, one
`user`, one `password`, and one or more `databases`. A multi-database application
uses one entry with several database names; it does not get one account or one
entry per database.

Every entry must set `state` explicitly to `present` or `absent`. An `absent`
entry still requires `name`, `user`, `password`, `databases`, and `cidrs` so the
role can identify the access to remove.

### PostgreSQL

```yaml
postgresql_apps:
  - state: present
    name: example
    user: example
    password: "{{ secret_postgresql_example_password }}"
    databases:
      - exampledb
    cidrs:
      - 192.0.2.0/24
    extensions: []
    connection_limit: -1
    rotate_password: false
```

Each `postgresql_apps` entry has these fields. The full schema is in
[`roles/postgresql/meta/argument_specs.yml`](../roles/postgresql/meta/argument_specs.yml).

| Field | Required | Default | Contract |
|---|---|---|---|
| `state` | Yes | None | `present` or `absent` |
| `name` | Yes | None | Unique lowercase application name, at most 63 characters |
| `user` | Yes | None | Unique lowercase PostgreSQL role, at most 63 characters; non-reserved; `LOGIN`, `NOSUPERUSER`, `NOCREATEDB`, `NOCREATEROLE` |
| `password` | Yes | None | SOPS-sourced password of at least 16 characters |
| `databases` | Yes | None | Non-empty, globally unique across all PostgreSQL app entries; lowercase non-system names; created empty and owned by `user` |
| `cidrs` | Yes | None | Non-empty unique source networks with a non-zero prefix; `0.0.0.0/0` and `::/0` are forbidden |
| `extensions` | No | `[]` | Unique lowercase extension names; created in every database for the app |
| `connection_limit` | No | `-1` | PostgreSQL role connection limit; `-1` or greater |
| `rotate_password` | No | `false` | Allow an existing role password to be updated |

PostgreSQL renders one `hostssl` rule per present app database, user, and CIDR
when TLS is enabled, or one `host` rule per present app when TLS is disabled. The
role rejects non-loopback app CIDRs when TLS is disabled. The role does not
create broad host `all`/`all` rules.

PostgreSQL uses database ownership instead of a separate per-object grant
contract. A present app database is owned by its app user. The role verifies role
attributes, database ownership, requested extensions, HBA rules, and TLS. It does
not create or verify the application's own schema objects or object grants.

### MariaDB

```yaml
mariadb_apps:
  - state: present
    name: example
    user: example
    password: "{{ secret_mariadb_example_password }}"
    databases:
      - exampledb
    cidrs:
      - 192.0.2.0/24
```

Each `mariadb_apps` entry has these fields. The full schema is in
[`roles/mariadb/meta/argument_specs.yml`](../roles/mariadb/meta/argument_specs.yml).

| Field | Required | Default | Contract |
|---|---|---|---|
| `state` | Yes | None | `present` or `absent` |
| `name` | Yes | None | Unique lowercase application name, at most 64 characters |
| `user` | Yes | None | Unique lowercase MariaDB account, at most 32 characters; non-reserved |
| `password` | Yes | None | SOPS-sourced password of at least 16 characters |
| `databases` | Yes | None | Non-empty, globally unique across all MariaDB app entries; lowercase non-system names; created with the configured encoding and collation |
| `cidrs` | Yes | None | Non-empty unique source networks with a non-zero prefix; `0.0.0.0/0` and `::/0` are forbidden |

MariaDB derives one account host per CIDR:

- IPv4 `/32` becomes an exact address, for example `127.0.0.1/32` becomes
  `127.0.0.1`.
- A broader IPv4 CIDR becomes the equivalent `network/netmask` account host.
- IPv6 `/128` becomes an exact address.
- Broader IPv6 CIDRs are rejected because MariaDB netmask syntax is IPv4-only.
  Use exact IPv6 `/128` addresses or IPv4 networks.

Each present MariaDB account receives `ALL` privileges only on the databases in
its entry, no global privileges, and `REQUIRE SSL`. `mariadb_apps` has no
`extensions`, `connection_limit`, or `rotate_password` field. A present entry
updates its password when the mapped password value changes.

## Lifecycle

### `state: present`

`present` creates or updates access:

- PostgreSQL creates or updates the role, creates missing databases and
  requested extensions, renders HBA access, and adds firewall exposure when
  firewall management is enabled. Existing role passwords are preserved unless
  that entry has `rotate_password: true`. Re-applying a present entry restores
  its HBA and firewall access.
- MariaDB creates or updates the database, one account per derived host,
  database-scoped grants, and `REQUIRE SSL`. Re-applying a present entry restores
  its full database grants.
- Both engines create databases empty. Nothing in `present` runs application
  migrations.

To add a database or CIDR to a running application, add it to the existing entry
and apply the role. For PostgreSQL, a missing database is created and new HBA and
firewall access is rendered. For MariaDB, a missing database is created and the
account and grant set is extended for the new hosts.

Do not remove a CIDR from a present entry as the only revocation step. The old
MariaDB account host is no longer managed by the role and can retain its grants,
and its firewall rule can remain until an absent entry exists for the CIDR.
PostgreSQL HBA is regenerated from the reduced list, but its firewall rule has the
same gap. To remove a CIDR safely, set the entry to `state: absent` with the
complete old values, apply, then set it back to `state: present` with the reduced
values if the application continues to use the database.

Removing a database name from a present MariaDB entry causes the module to replace
the current hosts' privilege set, and PostgreSQL stops rendering HBA for that
database. When the removal must be explicit and verified by the absent checks,
set the entry to `absent` with the old full values before applying the reduced
`present` entry.

Renaming a `user` or database is not an in-place rename. The role creates the new
objects and retains the old ones; plan a data migration and manual decommission.

### `state: absent`

`absent` is an access revocation, not data deletion. It removes:

- PostgreSQL: the app's HBA rules and firewall exposure for CIDRs that no present
  app uses. The role and databases are retained.
- MariaDB: the declared database grants and grant options for the declared
  databases and derived hosts, plus firewall exposure for CIDRs that no present
  app uses. The account and databases are retained.

`absent` does not:

- Drop the PostgreSQL role, MariaDB account, or any database.
- Delete data.
- Change a password or remove a MariaDB account's `REQUIRE SSL`.
- Revoke MariaDB global privileges, legacy grants, or privileges on undeclared
  databases.
- Disable login on a retained MariaDB account. It may still authenticate, and
  legacy global or undeclared privileges can still allow access; the role removes
  only the declared database grants.

Every `absent` entry still requires its password because the role argument spec
requires it, even though the password is not used to remove access.

Do not delete an application entry directly. A deleted entry is invisible to the
cleanup logic: MariaDB grants and firewall rules can remain, and PostgreSQL data
and roles remain without an entry that documents them. Transition the entry to
`absent`, apply the role, verify the access removal, and decommission data
separately.

### Decommissioning data

Data removal is a separate manual operation with a backup and rollback plan. It
is never performed by `state: absent`.

1. Schedule a maintenance window and stop application writes.
2. Back up every affected database with the engine's backup mechanism, copy the
   backup off-host, and test the restore. Local backups are not disaster
   recovery.
3. Set the entry to `state: absent` with its complete old values and apply the
   role. Verify that HBA, grants, and firewall exposure are gone.
4. Confirm the application is stopped or unable to use the database.
5. Using a reviewed DBA procedure, drop the databases and accounts. For MariaDB,
   also audit and remove legacy accounts, host patterns, global privileges, and
   grants that the current contract did not create.
6. Remove the entry from inventory and then remove the unused SOPS secret.
7. Retain the backup for the documented retention period and record the
   decommission and rollback point.

Rollback requires a verified backup restore, restoration of the `present` entry
with the same user, databases, and CIDRs, and redeployment of the application.
If a schema migration is part of the change, follow the application's migration
rollback procedure as well.

MariaDB accounts and host patterns created by older contracts are not removed
automatically. This includes accounts for `%`, `localhost`, or former CIDR
derivations, and any privileges outside the current entry's declared databases
and hosts. They require a manual audit and a reviewed cleanup.

## Secrets

The baseline secrets are:

```text
secret_postgresql_app_password
secret_mariadb_app_password
```

Additional applications use a distinct key named after the app:

```text
secret_postgresql_<name>_password
secret_mariadb_<name>_password
```

Rules:

- Add the key with `sops inventories/<env>/group_vars/all/environment.sops.yml`.
  Never write a plaintext password to inventory, a temporary repository file, a
  ticket, a commit message, a log, or chat.
- Map the key to the entry's `password` in the same encrypted environment file.
- Never reuse a password across applications or engines.
- Never delete a secret while an entry still references it. This includes an
  `absent` entry.
- `make generate ENV=<env>` creates only the baseline application passwords.
  It does not create secrets for additional apps. Add those manually with
  `sops` as described in [Secrets](SECRETS.md).
- Generate test passwords at runtime and never commit or reuse them.

PostgreSQL password rotation is opt-in. Update the SOPS value, set
`rotate_password: true` on that one entry, apply the role, verify the application,
then return the flag to `false`. MariaDB has no rotation flag: update the SOPS
value and apply the role; a present entry updates its account password.

A rotation is a coordinated change. Update the storage value and the
application's own secret store in the same maintenance window, verify the new
connection, and only then retire the old credential. The storage repository is
not a secret-distribution channel for application clusters.

See [Secrets](SECRETS.md) for SOPS, age key custody, and output protection.

## Network exposure

`cidrs` must contain the actual source networks that reach the storage host:
Kubernetes pod, node, egress, or private/VPN networks. Do not use
`0.0.0.0/0`, `::/0`, a default route, or an unnecessarily broad public range.
Keep the list as narrow as the application's real egress allows. If the
application is behind NAT, use the NAT source address, not an internal pod
address that never reaches the host.

| Control | PostgreSQL | MariaDB |
|---|---|---|
| Network scope | One HBA rule per present database, user, and CIDR | One account host per CIDR |
| Broad IPv6 | Avoid; HBA supports it but the policy requires least privilege | Rejected beyond exact `/128` |
| Firewall | Union of present app CIDRs | Union of present app CIDRs |
| Listener | `postgresql_listen_addresses` | `mariadb_bind_address` |

Database firewall exposure is the union of present application CIDRs. CIDRs used
only by absent entries have their database rich rules removed. Do not add ad hoc
`firewall-cmd` rules, open the database port directly, or create a broad rule
outside the app entries. A CIDR shared by a present and an absent entry stays
open for the present app.

Non-loopback applications require both:

- A reachable listener. PostgreSQL must include a non-loopback address in
  `postgresql_listen_addresses` while retaining `127.0.0.1` for local
  administration. MariaDB accepts `127.0.0.1` or `0.0.0.0`; a non-loopback app
  requires `mariadb_bind_address: "0.0.0.0"`.
- TLS, as described in the next section.

Do not expose either database directly to the public Internet. Applications
outside the private network must reach it through an approved private path or
VPN.

Firewall and SELinux behavior require a real AlmaLinux 10 host check; the Docker
test environment does not prove them. See [Testing](TESTING.md).

## TLS and certificate trust

PostgreSQL uses `hostssl` for present app rules when TLS is enabled. Any
non-loopback app CIDR requires TLS. Keep TLS enabled for loopback applications as
well unless there is a documented reason to disable it; CI uses loopback TLS.

MariaDB has no HBA file. Every app account is created with `REQUIRE SSL`, and the
server keeps `require_secure_transport` enabled, so MariaDB app connections use
TLS even over loopback.

Applications must verify the server certificate against the database CA and
check the hostname or IP address against the certificate SANs. Do not disable
certificate verification, use a trust-all mode, or accept an unverified
certificate.

- Production should use a certificate issued by the organization's CA.
- Development and CI may use generated TLS material. PostgreSQL generated mode
  creates a self-signed server certificate, so that certificate is the trust
  anchor for development clients. MariaDB generated mode creates a private CA
  and a server certificate signed by it; the CA certificate is the trust anchor.
- Generated development certificates are not for production.
- Distribute only the CA certificate (or the self-signed development server
  certificate for PostgreSQL) to application clients. Never distribute the CA
  private key or the server private key.

The certificate SANs must cover the hostname or IP address the application uses.
Adding a new endpoint may require a TLS certificate change as well as an app
entry change. Rotate the CA or server certificate as a coordinated storage and
application change: update the trust bundle first, then the server certificate,
then verify every application.

## Verification and evidence

### Storage role verification

Both roles verify configuration as the database administrator over the local
administrative path. PostgreSQL administration uses local peer authentication as
`postgres`; MariaDB uses `root` over the Unix socket. The roles do not log in as
application users; applications are external.

PostgreSQL verifies:

- Service health and `pg_isready`.
- Every present application role has `LOGIN`, no `SUPERUSER`, `CREATEDB`, or
  `CREATEROLE`, and the expected connection limit.
- Every present provisioner role has `LOGIN`, `CREATEDB`, `CREATEROLE`, no
  `SUPERUSER`, and the expected connection limit.
- Every present database exists and is owned by its app user.
- Requested extensions exist in every database for the app.
- `pg_hba_file_rules` has no parse errors and no broad `all`/`all` host rules.
- Absent apps and provisioners have no HBA rule.
- The running TLS setting and TLS file permissions.

PostgreSQL does not verify application-created schema objects or object grants.

MariaDB verifies:

- Service health and `mariadb-admin ping`.
- Every present database exists.
- Every present account exists for every derived host.
- `mysql.user.ssl_type` requires SSL.
- Every declared database has a `mysql.db` grant for every derived host.
- Present provisioners have global `CREATE` and `CREATE USER`, no global
  `GRANT OPTION` or administrative privileges, and a prefix-scoped `ALL/GRANT`
  row.
- Absent apps and provisioners have no database or prefix grants.
- TLS file permissions.

Neither role proves that an application can connect from its real network, that
its migrations succeed, or that its own secret store has the right credential.

### CI integration

`make integration` applies `site.yml` on the development container with the CI
inventory and ephemeral credentials, runs the verification playbook, and then
runs [`playbooks/integration-database.yml`](../playbooks/integration-database.yml).
That playbook logs in as each present CI PostgreSQL app for each
database over loopback with TLS and asserts the expected database, user, and
TLS session. It does the same for each present CI MariaDB app with the
MariaDB CA, asserting the expected database, account, and a non-empty
`Ssl_cipher`.

The same integration run proves the Elasticsearch snapshot read/write path
through Garage with the shared S3 key via
[`playbooks/integration-snapshot.yml`](../playbooks/integration-snapshot.yml).
That is cross-service storage evidence, not a database application proof. The
run ends by applying `site.yml` again and asserting `changed=0`.

CI does not test production application connectivity, production DNS or network
paths, production CA chains, real firewalld behavior, SELinux enforcement,
application migrations, or application secret distribution. A CI pass is not
acceptance for a production application.

### Application verification

After any database change, the application deployment must test its real
connection from its real source network, with certificate verification enabled,
and run its migrations. It must also verify application health and its rollback
path. For an access removal, confirm that the application can no longer reach the
database and that no data was lost.

## Adding an application

### Common checklist

- [ ] Choose PostgreSQL, MariaDB, or no managed database. Add no entry for a
      no-managed-database application.
- [ ] Use one entry with one unique `name`, one unique `user`, and a list of
      unique database names. Do not reuse names or databases from another entry.
- [ ] Avoid PostgreSQL and MariaDB reserved account and database names.
- [ ] Create a new SOPS password key, map it to the entry, and confirm the value
      is not reused. Never use plaintext or `extra_vars` for normal app data.
- [ ] Set `cidrs` to the actual private, pod, node, egress, or VPN source
      networks. Do not use default routes or broad public ranges.
- [ ] Set the listener and TLS configuration when any CIDR is non-loopback.
- [ ] Add the entry to each environment inventory that runs the application,
      with an explicit `state: present`. Do not branch on environment name.
- [ ] Apply to development, run the role verification, and have the application
      deployment prove its real connection and migrations.
- [ ] For production, take a backup, review `--check --diff`, obtain approval,
      apply, and verify the application.
- [ ] Record the engine choice, CIDRs, CA trust, backup, and rollback point in
      the pull request.

### PostgreSQL steps

1. Add the entry with `extensions: []` unless the application genuinely needs a
   supported extension. Extensions are created in every database for that app.
2. Set `connection_limit` only when the application needs a role limit. The
   default `-1` uses the server default.
3. Keep `rotate_password: false` except during a documented password rotation.
4. Enable TLS for non-loopback CIDRs and set `postgresql_listen_addresses` to an
   address the application can reach while retaining `127.0.0.1` for local
   administration.
5. Give the application the CA certificate, or the generated development server
   certificate, and configure `verify-full` or equivalent hostname and
   certificate verification.
6. Do not create a role, grant, or HBA line outside `postgresql_apps`.

### MariaDB steps

1. Add the entry with only the six documented fields. Do not add `extensions`,
   `connection_limit`, or `rotate_password`.
2. Derive the expected account hosts from `cidrs` before applying. Use exact IPv6
   `/128` addresses when IPv6 is required; broader IPv6 CIDRs fail by design.
3. For non-loopback CIDRs, set `mariadb_bind_address: "0.0.0.0"`. Keep the
   listener and firewall managed together.
4. Give the application the MariaDB CA certificate and configure certificate and
   hostname verification.
5. Do not create accounts or `GRANT` statements manually. Re-applying the entry
   restores the role-managed grants if they drift.

## Removing an application

- [ ] Schedule a maintenance window, stop writes, and take a verified backup.
      Copy it off-host.
- [ ] Keep the full entry, change only `state` to `absent`, and apply the role.
      Do not delete the entry yet.
- [ ] Verify that the relevant PostgreSQL HBA rules or MariaDB grants are gone,
      and that database firewall exposure for CIDRs no longer used by a present
      app is gone. The role or account, and the databases, must remain.
- [ ] Confirm the application is stopped or can no longer use the database.
- [ ] Decommission data with a reviewed DBA procedure: drop the databases and
      accounts only after the backup is verified.
- [ ] Audit MariaDB for legacy accounts, `%` or `localhost` hosts, global
      privileges, and grants outside the current entry. Remove them only after
      confirming no application uses them.
- [ ] After data and accounts are removed, remove the inventory entry and then
      the unused SOPS secret.
- [ ] Confirm no leftover database firewall rule or grant remains, and retain the
      backup for the documented retention period.

Rollback: restore the backup, restore the `present` entry with the same user,
databases, and CIDRs, apply the role, and redeploy the application. Record the
restore verification and any data loss window.

## Review checklist for future agents

- [ ] Engine choice is explicit; no entry exists for an application that does not
      use PostgreSQL or MariaDB.
- [ ] `name`, `user`, and every database name are unique and valid. Reserved
      names are not used.
- [ ] Each entry has an explicit `state`; `present` and `absent` follow the
      lifecycle above.
- [ ] No application entry is deleted directly, and no CIDR is removed from a
      present entry as the only revocation step.
- [ ] A database removed from a live app uses the absent transition when an
      explicit, verified revocation is required.
- [ ] No raw HBA, account, database-level `GRANT` or `REVOKE`, or firewall change
      is introduced in the storage repository.
- [ ] No application pipeline receives a superuser or administrative credential.
- [ ] The password comes from a new SOPS key, is mapped correctly, and is not
      reused or exposed.
- [ ] CIDRs are actual private or pod/node/egress sources, not default routes or
      broad public ranges.
- [ ] A non-loopback app has a reachable listener and TLS.
- [ ] The application verifies the server certificate against the CA and checks
      the certificate SAN; only the CA certificate is distributed.
- [ ] The role verification, CI integration, and the application's real
      connection and migration proof have been run as applicable.
- [ ] Documentation, backup, rollback, and decommission steps are updated.
- [ ] No environment name, hostname, or `extra_vars` controls database behavior.

## Known limitations

- **The HBA file is fully rendered.** This repository does not provide an HBA
  include or fragment mechanism, and PostgreSQL include directives are not used.
  The storage role is the sole writer of `pg_hba.conf`; manual edits are
  overwritten.
- **The storage role owns provisioner accounts and scope.** Application
  pipelines cannot create additional provisioners, grant outside their database
  prefix, change listeners, or change firewall access. They may use the scoped
  provisioner credential described above.
- **PostgreSQL grants are ownership-based.** The role verifies database ownership
  and role attributes, not per-object grants created by the application.
- **MariaDB has no per-app connection limit.** Only the global
  `mariadb_max_connections` setting exists. Do not treat it as an app-level
  control.
- **MariaDB account hosts are CIDR-derived.** Changing CIDRs creates new account
  hosts; old hosts and grants are not removed by a `present` apply.
- **MariaDB legacy access requires manual cleanup.** Accounts and host patterns
  from older contracts are not removed automatically.
- **Broader IPv6 is unsupported in MariaDB app accounts.** Use exact IPv6
  `/128` sources or an IPv4 network.
- **Generated certificates are development-only.** PostgreSQL generated mode is
  self-signed; MariaDB generated mode uses a local CA. Neither is automatically
  distributed or rotated in application trust stores.
- **PostgreSQL password rotation is opt-in.** Without `rotate_password: true`,
  an existing role keeps its old password even if the SOPS value changed.
- **Production app connectivity is not tested in CI.** CI proves development
  loopback logins and the snapshot path only. Production network paths, CA
  chains, firewalls, SELinux, migrations, and app secret stores are verified
  outside CI.
- **No high availability.** Each environment has one storage host. Local backups
  are not disaster recovery; copy them off-host.
- **One account can access all databases in its entry.** The contract is one
  account per application, not per database. Use separate applications when
  separate privilege boundaries are required.
