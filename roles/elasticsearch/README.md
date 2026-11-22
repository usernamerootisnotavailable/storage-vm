# elasticsearch

Installs and configures a single-node Elasticsearch 9 cluster with TLS,
security, and a Garage S3 snapshot repository.

## Responsibilities

- Import the Elastic signing key and configure the 9.x repository
- Install the pinned Elasticsearch package
- Set `vm.max_map_count` when supported
- Generate a private CA and server certificate, or validate provided TLS files
- Configure HTTPS and transport TLS
- Set the `elastic` bootstrap password and Garage S3 credentials in the keystore
- Start the service and wait for a healthy cluster
- Register and verify the Garage snapshot repository
- Add firewalld rules for approved HTTP client CIDRs
- Verify authentication and TLS

## Required variables

```yaml
elasticsearch_version: "9.5.6"
elasticsearch_bootstrap_password: "{{ secret_elasticsearch_bootstrap_password }}"
```

When the snapshot repository is enabled:

```yaml
storage_s3_access_key: "{{ secret_storage_s3_access_key }}"
storage_s3_secret_key: "{{ secret_storage_s3_secret_key }}"
```

## Security notes

- HTTP and transport TLS are always enabled.
- `elastic` is the only built-in user used by this role; its password is set from the bootstrap password on first start.
- Snapshot credentials are stored in the Elasticsearch keystore, not in cluster state.
- The default listener is loopback. External HTTP access requires setting the listener and approved CIDRs.
- Elasticsearch has no confined SELinux domain in AlmaLinux 10; the service runs in the unconfined service domain.

## Sizing

`elasticsearch_heap_size` defaults to `1g`; development sets `512m`. Set the heap to roughly half of available memory, capped at the JVM compressed-oops limit.

## Verification

The role checks service state, authenticated cluster health, unauthenticated rejection, TLS files, the JVM heap file, and the Garage snapshot repository when enabled.
