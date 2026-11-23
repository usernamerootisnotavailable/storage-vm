# garage

Installs and configures a single-node Garage S3-compatible object store.

## Responsibilities

- Download the pinned static Garage binary and verify its checksum
- Create a dedicated service user and data directories
- Configure a single-node layout with loopback-only listeners
- Bootstrap the cluster layout through the admin API
- Import the shared S3 credentials and create the snapshot bucket
- Grant the shared key read/write permissions without bucket ownership
- Verify the layout, key, and bucket

## Required variables

```yaml
garage_version: "2.5.0"
garage_binary_checksum: "sha256:..."
garage_rpc_secret: "{{ secret_garage_rpc_secret }}"
garage_admin_token: "{{ secret_garage_admin_token }}"
```

When `garage_manage_bucket` is true:

```yaml
storage_s3_access_key: "{{ secret_storage_s3_access_key }}"
storage_s3_secret_key: "{{ secret_storage_s3_secret_key }}"
```

## Bucket permissions

The shared key gets read and write permissions only. Elasticsearch snapshots do not need bucket ownership, and the owner flag grants bucket administration that this key does not require.

`AllowBucketKey` only activates permission flags; it cannot remove them. When an existing key still has owner access, the role removes it with `DenyBucketKey` before granting read/write. Both operations are idempotent.

## Security notes

- Garage does not terminate TLS. S3, admin, and RPC listeners must remain on loopback. Use a TLS reverse proxy for external S3 clients.
- Garage has no confined SELinux domain in AlmaLinux 10. The service runs in the unconfined service domain; a policy module is a future hardening task.
- The config contains the RPC secret and admin token. It is mode `0640`, owned `root:garage`.

## Backup note

Garage data is not backed up by this role. For disaster recovery, replicate the Garage cluster or take an offline snapshot of `garage_data_dir` and `garage_metadata_dir` and copy it off-host. The local Elasticsearch snapshots stored in Garage are not an off-host backup.

## Verification

The role checks the service, admin API, active layout, shared key, and read/write bucket permissions without owner access.
