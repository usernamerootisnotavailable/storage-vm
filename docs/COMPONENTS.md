# Components

Every service must satisfy the contract below before its role is merged. This file is the index; detailed role documentation lives in `docs/components/`.

## Verified platform data

Checked on 2026-11-21 against vendor repositories. Reverify before changing a pinned version or adding a new environment.

| Component | Source | Version observed | EL10 support | Status |
|---|---|---|---|---|
| PostgreSQL | PGDG `https://download.postgresql.org/pub/repos/yum/18/redhat/rhel-10-x86_64/` | 18.7 (`1PGDG.rhel10.3`) | Verified | Implemented |
| MariaDB | `https://mirror.mariadb.org/yum/11.8/rhel/10/x86_64/` | 11.8.10 (`1.el10`) | Verified | Planned |
| Garage | `https://garagehq.deuxfleurs.fr/_releases/v2.5.0/x86_64-unknown-linux-musl/garage` | 2.5.0 static musl binary | Binary is distribution-independent | Planned |
| Elasticsearch | `https://artifacts.elastic.co/packages/9.x/yum/` | 9.5.6 observed | Repository reachable; RPM install on EL10 not yet verified | Planned |

AlmaLinux 10 package availability verified for:

- `python3`, `python3-dnf`, `python3-psycopg2`
- `firewalld`, `python3-firewall`
- `python3-libselinux`, `libselinux-utils`
- `python3-cryptography`
- `policycoreutils-python-utils`
- `chrony`, `openssh-server`, `sudo`, `dnf-plugins-core`

## Required contract

Each component must document and implement:

### Package and source

- Vendor repository URL or binary source
- GPG key and verification method
- Exact tested version and how it is pinned
- EL10 compatibility evidence
- Fallback if the vendor does not support EL10

### Service layout

- Systemd unit name
- Dedicated user and group
- Configuration paths
- Data paths
- Log paths
- Default and configurable ports
- Bind addresses and exposure model

### Security

- TLS requirements and certificate source
- Authentication model
- Secrets and their rotation procedure
- File and directory permissions
- SELinux contexts and port labels
- firewalld rules and allowed source CIDRs
- Service account privileges

### Operations

- Initialization procedure
- Health check that proves the service works
- Backup procedure and retention
- Restore procedure, including a test
- Upgrade procedure and rollback
- Disk and memory sizing variables
- Monitoring or log locations

### Testing

- Molecule converge and verify
- Idempotence expectation
- Full-stack integration behavior
- Real-host checks that Docker cannot perform

## Cross-service integration

- Elasticsearch snapshot repositories may use Garage S3 over loopback.
- Application users for PostgreSQL and MariaDB are separate and least-privileged.
- Garage credentials are separate for each consumer and bucket.
- No service reads another service's secrets through `hostvars`.
- Internal traffic stays on loopback unless a documented client CIDR requires otherwise.
- Production backups must leave the host. Garage on the same host is not an off-host backup.

## PostgreSQL

See [`docs/components/postgresql.md`](components/postgresql.md).

## MariaDB

Planned. Must use the MariaDB 11.8 EL10 repository, a dedicated service user, TLS, least-privileged application users, and the same backup/verification standard as PostgreSQL.

## Garage

Planned. Must pin the v2.5.0 musl binary by version and checksum, run as a dedicated user, and use a single-node layout. TLS is required for any non-loopback S3 endpoint. Admin and RPC listeners stay on loopback.

## Elasticsearch

Planned. Must use the 9.x repository, enable security, configure TLS, run as a single node, and verify an S3 snapshot repository against Garage. The EL10 RPM install must be proven before the role is accepted.

## Adding a component

1. Add the verified source and version to the table.
2. Write the component document using the contract above.
3. Implement the role and tests.
4. Add the playbook before verification.
5. Update the status table and `README.md`.
