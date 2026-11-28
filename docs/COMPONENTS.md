# Components

Every service satisfies the contract below. Detailed role documentation lives in `docs/components/`.

## Verified component matrix

Checked against vendor repositories and tested where noted. Reverify before changing a pinned version.

| Component | Source | Version | EL10 support | Status |
|---|---|---|---|---|
| PostgreSQL | PGDG `https://download.postgresql.org/pub/repos/yum/18/redhat/rhel-10-x86_64/` | 18.7 (`1PGDG.rhel10.3`) | Verified | Implemented |
| MariaDB | `https://mirror.mariadb.org/yum/11.8/rhel/10/x86_64/` | 11.8.10 (`1.el10`) | Verified | Implemented |
| Garage | `https://garagehq.deuxfleurs.fr/_releases/v2.5.0/x86_64-unknown-linux-musl/garage` | 2.5.0 | Static musl binary | Implemented |
| Elasticsearch | `https://artifacts.elastic.co/packages/9.x/yum/` | 9.5.6 | Verified | Implemented |
| NGINX | AlmaLinux AppStream | 1.26.3 | Verified | Implemented |
| Certbot | PyPI virtualenv | 5.10.0 | Python >=3.10 | Implemented |
| certbot-dns-cloudflare | PyPI virtualenv | 5.10.0 | Python >=3.10 | Implemented |

AlmaLinux 10 package availability verified for:

- `python3`, `python3-dnf`, `python3-psycopg2`, `python3-PyMySQL`
- `python3-cryptography`, `python3-libselinux`, `libselinux-utils`
- `python3-pip`
- `firewalld`, `python3-firewall`
- `policycoreutils`, `policycoreutils-python-utils`
- `nginx`
- `chrony`, `openssh-server`, `sudo`, `dnf-plugins-core`

## Required contract

Each component documents and implements:

### Package and source

- Vendor repository URL or binary source
- GPG key/checksum and verification
- Exact tested version and pinning method
- EL10 compatibility evidence
- Fallback if a vendor does not support EL10

### Service layout

- Systemd unit
- Dedicated user and group
- Configuration, data, log, and TLS paths
- Ports and bind addresses
- Exposure model

### Security

- TLS requirements and certificate source
- Authentication model
- Secret storage and rotation
- File and directory permissions
- SELinux behavior
- firewalld rules and source CIDRs
- Service privileges

### Operations

- Initialization
- Health check that proves the service works
- Backup and restore
- Upgrade and rollback
- Sizing variables
- Log locations

### Testing

- Molecule converge and verify
- Idempotence
- Full-stack integration
- Real-host checks for SELinux and firewalld

## Service documentation

- [PostgreSQL 18](components/postgresql.md)
- [MariaDB 11.8](components/mariadb.md)
- [Garage 2.5](components/garage.md)
- [Elasticsearch 9](components/elasticsearch.md)
- [NGINX reverse proxy](components/nginx.md)

## Cross-service integration

### Shared S3 contract

Garage and Elasticsearch share four inventory variables:

```yaml
storage_s3_endpoint: "http://127.0.0.1:3900"
storage_s3_region: "garage"
storage_s3_bucket: "elasticsearch-snapshots"
storage_s3_access_key: "{{ secret_storage_s3_access_key }}"
storage_s3_secret_key: "{{ secret_storage_s3_secret_key }}"
```

- Garage imports the access key and creates the bucket.
- Elasticsearch stores the access key/secret in its keystore and registers the bucket as its snapshot repository.
- The bucket key has read/write permissions only. Bucket ownership is unnecessary for snapshots and is removed with `DenyBucketKey` when present.
- The S3 endpoint and listeners are loopback-only.

### Elasticsearch and Garage compatibility

Garage 2.5 rejects the AWS SDK's aws-chunked trailer signatures. Elasticsearch must set:

```yaml
s3.client.default.disable_chunked_encoding: true
```

The complete Elasticsearch snapshot flow (register, verify, snapshot) was validated against Garage 2.5.0.

### NGINX front door

- `https://es.<base-domain>` proxies to Elasticsearch over verified loopback TLS.
- `https://s3.<base-domain>` proxies to Garage over loopback HTTP with the Host header preserved.
- External S3 clients must use path-style addressing and disable AWS SDK chunked trailer checksums for Garage compatibility.
- Elasticsearch snapshots keep using `http://127.0.0.1:3900` and do not depend on NGINX.
- Port 443 is restricted to explicit private or VPN CIDRs; public CIDRs are rejected.
- Certificates use Let's Encrypt DNS-01 through Cloudflare in production and a generated CA in development/CI.

### Database independence

See [Database applications](DATABASES.md) for the normative cross-engine policy
that governs these contracts.

- PostgreSQL and MariaDB have separate application accounts, databases,
  passwords, and ports.
- PostgreSQL applications are declared in `postgresql_apps`. Each present app
  gets its own role, databases, requested extensions, per-database HBA rules,
  and firewall exposure from its CIDRs.
- MariaDB applications are declared in `mariadb_apps`. Each present app gets its
  databases, one account per CIDR-derived host, database-scoped grants, and
  firewall exposure from its CIDRs.
- MariaDB has no HBA file. Its network scope is the account host plus `mysql.db`
  grants. Every app account requires SSL and is verified through
  `mysql.user.ssl_type`.
- PostgreSQL and MariaDB app accounts and databases are not dropped when an app
  becomes `state: absent`; only access is removed. Data removal is manual.
- PostgreSQL HBA rules are generated by the role. MariaDB accounts and grants
  are generated from `mariadb_apps`. Do not add raw rules or grants.
- App deployments own migrations and connectivity verification.
- Database clients connect over loopback by default.
- External database access requires both listener changes and approved firewall
  CIDRs.
- Both roles reject default-route app CIDRs. PostgreSQL requires TLS for
  non-loopback app CIDRs; MariaDB requires TLS for every app account.
- Optional scoped provisioner accounts let an application create its own roles,
  databases, and grants without a superuser. See
  [Application provisioning](APP-PROVISIONING.md).

## SELinux posture

| Service | SELinux behavior |
|---|---|
| PostgreSQL | Custom file contexts and port labels; enforcing |
| MariaDB | Vendor `mariadb.pp` installed; enforcing |
| Garage | No confined domain in AlmaLinux 10; unconfined service domain |
| Elasticsearch | No confined domain in AlmaLinux 10; unconfined service domain |
| NGINX | `httpd_t`; TLS files labeled `httpd_config_t`; upstream ports labeled `http_port_t` |

The unconfined domains are documented gaps. File permissions, loopback binding, and service users still apply. A future hardening phase can add policy modules.

## Backup matrix

| Component | Local backup | Off-host requirement |
|---|---|---|
| PostgreSQL | `pg_dumpall` timer | Copy `/var/backups/postgresql` off-host |
| MariaDB | `mariadb-dump` timer | Copy `/var/backups/mariadb` off-host |
| Garage | Not automated | Replicate cluster or snapshot metadata/data off-host |
| Elasticsearch | Snapshots to Garage | Replicate Garage or copy snapshots off-host |

Local backups on the same host are not disaster recovery.

## Verification evidence

- PostgreSQL configuration, TLS, SCRAM authentication, and backup script tested with the actual PG18.7 binary.
- MariaDB configuration, TLS, multiple application accounts, CIDR-derived account hosts, database grants, and dump script tested with the actual 11.8.10 binaries.
- Garage 2.5.0 config, single-node layout, key import, bucket creation, and permissions tested with the actual binary and admin API.
- Elasticsearch 9.5.6 TLS, bootstrap password, authentication, and Garage S3 snapshot flow tested with the actual package and a running Garage instance.
- NGINX configuration syntax, TLS termination, Elasticsearch HTTPS upstream verification, and S3 HTTP proxying were validated with the AlmaLinux 10 NGINX 1.26.3 binary and local dummy upstreams. Molecule and full-stack integration exercise the role and real service routing. Let's Encrypt DNS-01, Cloudflare API access, and SELinux `httpd_t` network policy require a real host and real Cloudflare credentials.
- Molecule and full-stack integration run package installation and systemd service checks in CI. SELinux enforcement, firewalld behavior, and real-host certificate issuance require a real AlmaLinux 10 host.
