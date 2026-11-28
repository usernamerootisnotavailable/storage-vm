# Elasticsearch 9

## Overview

The `elasticsearch` role installs Elasticsearch 9.5.6 as a single-node cluster with HTTPS and transport TLS, security enabled, a bootstrap password for the `elastic` user, and a Garage S3 snapshot repository.

## Tested platform

- AlmaLinux 10 x86_64
- Elasticsearch 9.5.6
- `https://artifacts.elastic.co/packages/9.x/yum/`
- Garage 2.5.0 S3 snapshot repository verified

## Layout

| Item | Default |
|---|---|
| Configuration | `/etc/elasticsearch/elasticsearch.yml` |
| TLS material | `/etc/elasticsearch/certs` |
| Data | `/var/lib/elasticsearch` |
| Logs | `/var/log/elasticsearch` |
| Service | `elasticsearch.service` |
| HTTP | `127.0.0.1:9200` |
| Transport | `127.0.0.1:9300` |
| User/group | `elasticsearch` / `elasticsearch` |

## Variables

| Variable | Default | Description |
|---|---|---|
| `elasticsearch_version` | required | Full version from inventory |
| `elasticsearch_heap_size` | `1g` | JVM heap |
| `elasticsearch_network_host` | `127.0.0.1` | `127.0.0.1` or `0.0.0.0` |
| `elasticsearch_http_port` | `9200` | HTTP port |
| `elasticsearch_transport_port` | `9300` | Transport port |
| `elasticsearch_allowed_cidrs` | `[]` | firewalld source CIDRs |
| `elasticsearch_manage_sysctl` | `true` | Set `vm.max_map_count` |
| `elasticsearch_bootstrap_password` | required | Bootstrap password from SOPS |
| `elasticsearch_tls_mode` | `generated` | `generated` or `provided` |
| `elasticsearch_snapshot_repo_enabled` | `true` | Register the Garage repository |
| `elasticsearch_snapshot_repo_name` | `garage` | Repository name |
| `elasticsearch_snapshot_bucket` | shared bucket | Garage bucket |
| `elasticsearch_s3_endpoint` | shared endpoint | Garage S3 URL |
| `elasticsearch_s3_region` | shared region | S3 region |

## Security

- `xpack.security.enabled` is always true.
- HTTPS and transport TLS are always enabled.
- The `elastic` bootstrap password is stored in the Elasticsearch keystore.
- Unauthenticated HTTP requests must return `401`.
- The default listener is loopback.
- External HTTP access requires setting the listener, approved CIDRs, and a certificate with the correct SAN.

Per-application users are created by hand; see
[Application provisioning](../APP-PROVISIONING.md#elasticsearch-app-credentials).

### TLS files must live under the configuration directory

Elasticsearch 9's entitlement controls block SSL file reads outside `ES_PATH_CONF`. The role asserts that the CA, certificate, and key all live under `/etc/elasticsearch`. The default certs directory satisfies this.

### Generated TLS

The role creates a private CA and a server certificate with SANs for the inventory hostname, localhost, and 127.0.0.1. The CA key stays root-only.

### Provided TLS

The role validates that the CA and certificate are readable by `elasticsearch` and that the key is owned by `elasticsearch` with mode `0600` or `0640`.

## Snapshots to Garage

The Garage S3 endpoint is configured as the default S3 client:

```yaml
s3.client.default.endpoint: "http://127.0.0.1:3900"
s3.client.default.path_style_access: true
s3.client.default.disable_chunked_encoding: true
s3.client.default.region: garage
```

The access key and secret key are stored as secure settings in the Elasticsearch keystore:

- `s3.client.default.access_key`
- `s3.client.default.secret_key`

The repository is registered with:

```json
{
  "type": "s3",
  "settings": {
    "bucket": "elasticsearch-snapshots"
  }
}
```

`disable_chunked_encoding` is required: Garage 2.5 rejects the AWS SDK's default aws-chunked trailer signature with `400 Invalid payload signature`.

The full flow was verified with a real Elasticsearch 9.5.6 process and Garage 2.5.0, including `_verify` and a successful snapshot. Integration also creates, reads, and deletes a test snapshot to prove the shared read/write Garage key works without bucket ownership.

## Sizing

- Set `elasticsearch_heap_size` to roughly half of available memory.
- Keep `bootstrap.memory_lock` disabled; the role does not raise memlock limits.
- `elasticsearch_manage_sysctl` sets `vm.max_map_count=262144` in production.
- Development containers must have `vm.max_map_count` set on the Docker host.

## SELinux

AlmaLinux 10 does not provide a confined SELinux domain for Elasticsearch. The service runs in the unconfined service domain. A dedicated policy module is a future hardening task.

## Backup and restore

Elasticsearch snapshots are written to Garage. This is not an off-host backup because Garage runs on the same host. Replicate Garage data or copy snapshots to an external target.

Restore outline:

1. Register the same repository.
2. List snapshots.
3. Restore indices with `_snapshot/<repo>/<snapshot>/_restore`.
4. Verify document counts and application queries.

## Verification

The role verifies:

- Service state
- Authenticated cluster health (`green` or `yellow`)
- Unauthenticated access returns `401`
- TLS file presence and key permissions
- JVM heap options
- Garage repository verification when enabled

## Upgrade

1. Read Elastic release notes and breaking changes.
2. Take a snapshot and confirm it is restorable.
3. Pin the new version in `versions.yml`.
4. Apply during a maintenance window.
5. Verify cluster health, authentication, and the snapshot repository.

Elasticsearch does not support downgrades. Keep the previous data directory and snapshot until the upgrade is proven.

## Troubleshooting

| Symptom | Check |
|---|---|
| Service fails to start | `/var/log/elasticsearch/<cluster>.log`, `journalctl -u elasticsearch` |
| TLS file read blocked | Ensure certs are under `/etc/elasticsearch` |
| Authentication fails | Bootstrap password in keystore, `elastic` user password |
| Snapshot repository fails | Garage bucket/key permissions, endpoint, `disable_chunked_encoding` |
| `max virtual memory areas` error | `vm.max_map_count` on the host |
