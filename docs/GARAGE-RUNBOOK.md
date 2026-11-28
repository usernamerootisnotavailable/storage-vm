# Garage runbook

Garage is managed manually. The storage roles bootstrap the single-node layout
and the shared Elasticsearch snapshot bucket, but they do not create
application buckets or keys. This runbook uses the loopback-only Garage admin
CLI on the storage host. Do not expose the admin API.

## Inspect

```bash
sudo garage -c /etc/garage.toml status
sudo garage -c /etc/garage.toml key list
sudo garage -c /etc/garage.toml bucket list
```

The admin API listens only on loopback. Run these commands on the host over SSH.

## Create a key

Run this in a trusted terminal. `garage key create` prints the access key and
secret once; do not paste the output into chat, tickets, logs, or shell history.

```bash
KEY_NAME="<REPLACE_WITH_KEY_NAME>"
sudo garage -c /etc/garage.toml key create "$KEY_NAME"
```

Record the printed access key and secret immediately in the destination secret
store:

- Shared Elasticsearch snapshot key: `secret_storage_s3_access_key` and
  `secret_storage_s3_secret_key` in
  `inventories/<env>/group_vars/all/environment.sops.yml`.
- Application key: the application's own secret store. Do not add it to this
  repository unless the application contract requires it here.

If the existing key's secret is lost, create a new key, update the consumer,
verify access, and remove the old key only after verification.

## Create a bucket and grant access

```bash
BUCKET="<REPLACE_WITH_BUCKET_NAME>"
KEY_NAME="<REPLACE_WITH_KEY_NAME>"

sudo garage -c /etc/garage.toml bucket create "$BUCKET"
sudo garage -c /etc/garage.toml bucket allow \
  --read --write "$BUCKET" --key "$KEY_NAME"
sudo garage -c /etc/garage.toml bucket info "$BUCKET"
```

Do not grant `--owner` for application or snapshot keys. Read/write is enough;
owner permission allows administrative bucket operations.

## Expected bucket and key names

Names only; values live in SOPS or the application secret store.

| Purpose | Bucket | Key |
|---|---|---|
| Elasticsearch snapshots | `elasticsearch-snapshots` | `elasticsearch-snapshots` |
| Application data | `<app>-<purpose>` | `<app>-<purpose>` |

Application buckets and keys are created only when an application needs them.
Do not pre-create placeholders.

## Restore

Garage data is not useful without its metadata. The metadata store contains the
cluster layout, key records, bucket records, and permissions; the data
directories contain object blocks. Restoring only the blocks cannot reconstruct
the buckets or keys.

1. Stop Garage: `sudo systemctl stop garage`.
2. Restore `garage_metadata_dir` and `garage_data_dir` together from the same
   backup point.
3. Start Garage: `sudo systemctl start garage`.
4. Verify `garage status`, the layout, `garage key list`, and
   `garage bucket info "$BUCKET"`.
5. Verify the Elasticsearch snapshot repository and a test snapshot.
6. Test the restore on a non-production host before relying on it.

Local snapshots are not disaster recovery. Copy the metadata and data off-host,
or replicate the Garage cluster. See the backup matrix in
[Components](COMPONENTS.md#backup-matrix).

## App credential handoff

For a new application, create only the bucket and key names listed in
[Application provisioning](APP-PROVISIONING.md). Store the credential in the
application's secret store. This repository does not automate Garage.
