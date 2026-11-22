# Components

Every service satisfies the contract below. Detailed role documentation lives in `docs/components/`.

## Verified component matrix

Checked against vendor repositories and tested where noted. Reverify before changing a pinned version.

| Component | Source | Version | EL10 support | Status |
|---|---|---|---|---|
| PostgreSQL | PGDG `https://download.postgresql.org/pub/repos/yum/18/redhat/rhel-10-x86_64/` | 18.7 (`1PGDG.rhel10.3`) | Verified | Implemented |
| MariaDB | `https://mirror.mariadb.org/yum/11.8/rhel/10/x86_64/` | 11.8.10 (`1.el10`) | Verified | Implemented |
| Garage | `https://garagehq.deuxfleurs.fr/_releases/2.5.0/x86_64-unknown-linux-musl/garage` | 2.5.0 | Static musl binary | Implemented |
| Elasticsearch | `https://artifacts.elastic.co/packages/9.x/yum/` | 9.5.6 | Verified | Implemented |

AlmaLinux 10 package availability verified for:

- `python3`, `python3-dnf`, `python3-psycopg2`, `python3-PyMySQL`
- `python3-cryptography`, `python3-libselinux`, `libselinux-utils`
- `firewalld`, `python3-firewall`
- `policycoreutils`, `policycoreutils-python-utils`
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
- The bucket key has owner/read/write permissions.
- The S3 endpoint and listeners are loopback-only.

### Elasticsearch and Garage compatibility

Garage 2.5 rejects the AWS SDK's aws-chunked trailer signatures. Elasticsearch must set:

```yaml
s3.client.default.disable_chunked_encoding: true
```

The complete Elasticsearch snapshot flow (register, verify, snapshot) was validated against Garage 2.5.0.

### Database independence

- PostgreSQL and MariaDB have separate application users, databases, passwords, and ports.
- Database clients connect over loopback by default.
- External database access requires both listener changes and approved firewall CIDRs.
- MariaDB TCP application users require TLS.

## SELinux posture

| Service | SELinux behavior |
|---|---|
| PostgreSQL | Custom file contexts and port labels; enforcing |
| MariaDB | Vendor `mariadb.pp` installed; enforcing |
| Garage | No confined domain in AlmaLinux 10; unconfined service domain |
| Elasticsearch | No confined domain in AlmaLinux 10; unconfined service domain |

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
- MariaDB configuration, TLS, application authentication, and dump script tested with the actual 11.8.10 binaries.
- Garage 2.5.0 config, single-node layout, key import, bucket creation, and permissions tested with the actual binary and admin API.
- Elasticsearch 9.5.6 TLS, bootstrap password, authentication, and Garage S3 snapshot flow tested with the actual package and a running Garage instance.
- Container package installation, systemd services, SELinux enforcement, and firewalld behavior remain CI/real-host validation items.
