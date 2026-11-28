# Garage 2.5

## Overview

The `garage` role installs a pinned static Garage binary, configures a single-node S3-compatible object store, bootstraps the cluster layout through the admin API, and provisions the shared S3 key and snapshot bucket.

## Tested platform

- AlmaLinux 10 x86_64
- Garage 2.5.0
- Binary: `https://garagehq.deuxfleurs.fr/_releases/v2.5.0/x86_64-unknown-linux-musl/garage`
- SHA256: `2ff667286217cd73ebcb1c03af993822365000441dfe31a80cb64c5189a9dea8`

## Layout

| Item | Default |
|---|---|
| Binary | `/usr/local/bin/garage` |
| Configuration | `/etc/garage.toml` |
| Metadata | `/var/lib/garage/meta` |
| Data | `/var/lib/garage/data` |
| Service | `garage.service` |
| S3 API | `127.0.0.1:3900` |
| RPC | `127.0.0.1:3901` |
| Admin API | `127.0.0.1:3903` |
| User/group | `garage` / `garage` |

## Variables

| Variable | Default | Description |
|---|---|---|
| `garage_version` | required | Full version from inventory |
| `garage_binary_checksum` | required | Pinned SHA256 checksum |
| `garage_rpc_secret` | required | 64-hex RPC secret from SOPS |
| `garage_admin_token` | required | Admin API token from SOPS |
| `garage_zone` | `dc1` | Layout zone |
| `garage_node_capacity_bytes` | `1073741824` | Layout capacity in bytes |
| `garage_s3_bucket` | shared bucket | Snapshot bucket alias |
| `garage_s3_access_key` | shared access key | 16-hex S3 key ID |
| `garage_s3_secret_key` | shared secret | 64-hex S3 secret |
| `garage_manage_bucket` | `true` | Create/verify the key and bucket |

## Single-node layout

The admin API is used to:

1. Wait for `GetClusterStatus`.
2. Read `GetClusterLayout`.
3. Stage a role for the local node with the configured zone and capacity.
4. Apply layout version `current + 1`.
5. Refuse to modify a non-empty layout that excludes the node.

The default capacity is 1 GiB for development. Set `garage_node_capacity_bytes` to the intended data capacity in production.

## S3 credentials and bucket

The role imports a pre-generated key rather than generating a secret on the host. This makes the key idempotent and lets Elasticsearch consume the same credentials from SOPS.

- Access key: 16 hex characters
- Secret key: 64 hex characters
- Bucket: shared `storage_s3_bucket`
- Permissions: read, write

Bucket ownership is unnecessary for Elasticsearch snapshots and would grant bucket administration that the shared key does not need. `AllowBucketKey` only activates permission flags, so the role removes owner access from an existing key with `DenyBucketKey` before granting read/write. Both operations are idempotent.

The admin API is used because it avoids placing secrets in process arguments.

## TLS and network exposure

Garage does **not** terminate TLS. The role asserts that S3, admin, and RPC listeners bind to loopback. External S3 access requires a TLS reverse proxy, which is outside this role's scope.

Elasticsearch snapshots use Garage over loopback.

## Elasticsearch compatibility

Elasticsearch's AWS SDK defaults to aws-chunked trailer signatures that Garage 2.5 rejects as `Invalid payload signature`. The Elasticsearch role disables chunked encoding with:

```yaml
s3.client.default.disable_chunked_encoding: true
```

The full snapshot flow was verified against Garage 2.5.0.

## SELinux

AlmaLinux 10 has no confined SELinux domain for Garage. The service runs in the unconfined service domain. Data and configuration permissions are restrictive, but a dedicated policy module is a future hardening task.

## Backups

Garage data is not backed up by this role. For disaster recovery:

1. Replicate the Garage cluster to another host, or
2. Stop Garage and snapshot `garage_data_dir` and `garage_metadata_dir`, then copy the snapshot off-host.

Elasticsearch snapshots stored in Garage are not an off-host backup if Garage runs on the same host.

Manual bucket and key operations, including restore, are in
[`docs/GARAGE-RUNBOOK.md`](../GARAGE-RUNBOOK.md).

## Verification

The role verifies:

- Service state
- Admin API availability
- Active layout version and node role
- Shared S3 key presence
- Bucket read/write permissions with owner access removed

## Upgrade

1. Read the Garage release notes. Garage 2.x upgrades may not be reversible.
2. Pin the new version and checksum in `versions.yml`.
3. Back up metadata and data or confirm replication.
4. Apply during a maintenance window.
5. Verify the layout, key, bucket, and Elasticsearch snapshot repository.
