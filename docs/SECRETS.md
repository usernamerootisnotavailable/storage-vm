# Secrets with SOPS and age

## Model

- Secrets and environment values are encrypted with [SOPS](https://getsops.io/)
  3.12 or newer using age recipients.
- Encrypted files are committed to git. Plaintext rendered files are never
  committed.
- Each environment has its own age recipient and private identity.
- The development key must not decrypt production files, and vice versa.
- Decryption happens on the controller. Managed hosts never receive an age key.
- Ansible loads encrypted variables through the `community.sops.sops` vars
  plugin.
- Shared connection, VM, and Proxmox placement values live in an encrypted
  infrastructure file with no credentials. Ansible loads it, and OpenTofu reads
  it through `data "sops_file"`.
- The Proxmox API token and OpenTofu state passphrase live in a separate
  OpenTofu-only file so Ansible never receives them.

## Repository layout

```text
.sops.yaml
inventories/dev/group_vars/all/environment.sops.yml
inventories/dev/group_vars/all/environment.sops.yml.example
inventories/dev/group_vars/all/infrastructure.sops.yml
inventories/dev/group_vars/all/infrastructure.sops.yml.example
inventories/prod/group_vars/all/environment.sops.yml
inventories/prod/group_vars/all/environment.sops.yml.example
inventories/prod/group_vars/all/infrastructure.sops.yml
inventories/prod/group_vars/all/infrastructure.sops.yml.example
tofu/dev.sops.yml
tofu/dev.sops.yml.example
tofu/prod.sops.yml
tofu/prod.sops.yml.example
inventories/ci/                                      plaintext synthetic values
```

`environment.sops.yml` contains the environment's Ansible service values and
its `secret_*` credentials. `infrastructure.sops.yml` contains connection
details, VM sizing, and Proxmox placement values; it must not contain
passwords. Keeping infrastructure separate lets OpenTofu read it without
placing database passwords in state.

`tofu/<env>.sops.yml` contains only the Proxmox endpoint/token and the state
encryption passphrase. It is read through an ephemeral SOPS resource and is
never loaded by Ansible.

The plugin only loads files ending in `.sops.yml`, `.sops.yaml`, or `.sops.json`.
An unencrypted file with one of those extensions causes an error. Templates use
the `.example` suffix and are not loaded by the plugin.

## `.sops.yaml`

Add two rules per environment before running `make generate`: one for the
Ansible environment file and one for the OpenTofu file.

```yaml
creation_rules:
  - path_regex: ^inventories/dev/.*\.sops\.ya?ml$
    age: age1devrecipient...
  - path_regex: ^tofu/dev\.sops\.ya?ml$
    age: age1devrecipient...
  - path_regex: ^inventories/prod/.*\.sops\.ya?ml$
    age: age1prodrecipient...
  - path_regex: ^tofu/prod\.sops\.ya?ml$
    age: age1prodrecipient...
```

Rules are evaluated in order; the first match wins. Paths are relative to
`.sops.yaml`. The file must be named exactly `.sops.yaml`; SOPS does not
auto-discover `.sops.yml`.

Security review is required for any change to `.sops.yaml`. Adding a recipient
grants that identity read access to every file matching the rule. Never add a
private key.

## Key custody

Generate one age identity per environment:

```bash
mkdir -p ~/.config/sops/age
age-keygen -o ~/.config/sops/age/dev.keys.txt
age-keygen -o ~/.config/sops/age/prod.keys.txt
chmod 600 ~/.config/sops/age/*.keys.txt
```

The command prints the public recipient (`age1...`). Add only the public
recipient to `.sops.yaml`.

- Never store private keys in the repository, an inventory, CI logs, or a
  managed host.
- Never put both environment keys in the default `~/.config/sops/age/keys.txt`;
  use separate files selected by `SOPS_AGE_KEY_FILE`.
- Back up each private key offline. Losing a production key means losing the
  ability to decrypt existing files unless the plaintext is recoverable
  elsewhere.
- Production key access is restricted to operators and the protected GitHub
  `prod` environment.
- Development keys may be shared among developers, but must still remain outside
  the repository.

Local use:

```bash
export SOPS_AGE_KEY_FILE="$HOME/.config/sops/age/dev.keys.txt"
```

Production use:

```bash
export SOPS_AGE_KEY_FILE="$HOME/.config/sops/age/prod.keys.txt"
ansible-playbook -i inventories/prod/hosts.yml site.yml --check --diff
```

Using the wrong key fails closed during decryption. This is intentional.

## Generating environment files

Run `make generate ENV=<dev|prod>`. The command:

1. Refuses to overwrite any existing encrypted output.
2. Creates `~/.config/sops/age/<env>.keys.txt` when it does not exist.
3. Prints the public recipient and requires a matching `.sops.yaml` rule.
4. Renders the committed `*.example` templates.
5. Replaces the `__GENERATE_HEX_*__` markers with random credentials.
6. Encrypts each rendered file with SOPS and verifies that the generated age key
   can decrypt it.
7. Writes each encrypted output with mode `0600` and removes the plaintext
   temporary files.

The first run may create the key and then fail because `.sops.yaml` has no
matching rule. Add the printed public recipient to the correct rule and run the
same command again.

Preview without creating a key or writing files:

```bash
make generate ENV=dev DRY_RUN=1
```

`scripts/init-secrets.sh` is a compatibility wrapper for `scripts/generate.sh`.
Do not add a force flag: an existing environment is changed with `sops`, not by
regenerating it.

## Creating and editing values

The generated files contain two kinds of placeholders:

- `__GENERATE_HEX_8__` and `__GENERATE_HEX_32__` are replaced by `make generate`.
- `<REPLACE_WITH_...>` values must be supplied by the operator.

After generation:

```bash
sops inventories/dev/group_vars/all/environment.sops.yml
sops inventories/dev/group_vars/all/infrastructure.sops.yml
sops tofu/dev.sops.yml
```

SOPS opens a temporary decrypted file in the editor, re-encrypts on save, and
removes the temporary file. Edit only on a trusted workstation.

Never run:

```bash
sops --decrypt file.sops.yml > plaintext.yml
```

## Variable naming

Only `secret_*` values are credentials. They live in `environment.sops.yml`
with the Ansible service values. `infrastructure.sops.yml` contains connection,
VM, and placement values but no credentials. OpenTofu reads that file through
`data "sops_file"`, so database passwords never enter OpenTofu state.

```yaml
secret_postgresql_app_password: "..."
secret_mariadb_app_password: "..."
secret_garage_rpc_secret: "..."
secret_garage_admin_token: "..."
secret_storage_s3_access_key: "..."
secret_storage_s3_secret_key: "..."
secret_elasticsearch_bootstrap_password: "..."
secret_nginx_cloudflare_api_token: "..."

postgresql_apps:
  - state: present
    name: app
    user: app
    password: "{{ secret_postgresql_app_password }}"
    databases:
      - appdb
    cidrs:
      - "<REPLACE_WITH_APP_CIDR>"
```

The baseline PostgreSQL secret is `secret_postgresql_app_password`. Additional
apps use a distinct key such as `secret_postgresql_<name>_password`. The baseline
MariaDB secret is `secret_mariadb_app_password`; additional MariaDB apps use
`secret_mariadb_<name>_password`. Never reuse one password across applications.

Do not use `secret_*` names inside roles. Roles consume the mapped variables.

The OpenTofu-only file uses:

```yaml
proxmox_endpoint: "..."
proxmox_api_token_id: "..."
proxmox_api_token_secret: "..."
proxmox_insecure: false
tofu_state_passphrase: "..."
```

`proxmox_endpoint`, the token, and the state passphrase are never placed in the
Ansible inventory. The state passphrase must be 64 lowercase hex characters;
`scripts/tofu.sh` validates it before building `TF_ENCRYPTION`.

Because the SOPS files contain both values and credentials, the
`register_values_as_secrets = True` setting also redacts non-secret values from
task output. That is intentional defense in depth.

## Output protection

`ansible.cfg` enables:

```ini
[community.sops]
register_values_as_secrets = True
handle_unencrypted_files = error
```

`register_values_as_secrets` marks every value loaded from a SOPS file as secret
and redacts it from Ansible output. This requires ansible-core 2.22 or newer.

Masking is defense in depth, not permission to print secrets:

- Add `no_log: true` to tasks that pass passwords to modules or commands.
- Set `diff: false` on templates or files that contain secrets.
- Do not use `debug: var` on variables derived from secrets.
- Do not pass secrets on command lines where they appear in `ps`.
- Do not enable `log_path` in `ansible.cfg`.

## CI and GitHub Actions

- Each GitHub Environment (`dev`, `prod`) may store its age private key as
  `SOPS_AGE_KEY` for protected deployment jobs. The normal CI jobs do not need
  it.
- Lint, syntax, literal, Molecule, and OpenTofu validation jobs use
  `inventories/ci`, which is plaintext and contains no real values.
- Fork pull requests never receive environment secrets.
- Integration tests generate ephemeral test credentials at runtime; they do not
  use the committed SOPS files.
- Do not echo secrets, enable shell tracing around decryption, or upload
  decrypted artifacts.

## Rotation

### Rotate a database password

1. Change the value with `sops`.
2. Apply the role with the appropriate tag.
3. Verify the service accepts the new credential.
4. Revoke the old credential at the source.

For PostgreSQL, password changes are skipped per app by default to preserve
idempotence. Set `rotate_password: true` on the affected `postgresql_apps` entry
for the rotation run, then return it to `false`. Other apps keep
`rotate_password: false`.

MariaDB application accounts are updated by `ansible.mariadb.mariadb_user` when
the password of a present `mariadb_apps` entry changes. Setting an app to
`state: absent` removes database grants and firewall access but does not change
or drop the account.

### Rotate the Elasticsearch elastic password

The bootstrap password only applies when the cluster is first initialized. To
rotate it:

1. Use the Elasticsearch password API or `elasticsearch-reset-password` for the
   `elastic` user.
2. Update `secret_elasticsearch_bootstrap_password` to the same value in SOPS.
3. Verify authentication.
4. Keep the keystore's `bootstrap.password` entry consistent for future recovery
   documentation.

### Rotate the Garage S3 key

1. Generate a new 16-hex access key and 64-hex secret.
2. Update the shared S3 secrets in SOPS.
3. Apply the Elasticsearch role with `elasticsearch_rotate_s3_secrets: true`;
   this rewrites the keystore entries and restarts Elasticsearch. Return the
   setting to `false`.
4. Verify the snapshot repository.
5. Remove the old Garage key after verifying snapshots.

Garage key IDs are immutable. If the access key ID changes, import the new key
and grant it bucket permissions before removing the old one.

### Rotate the Garage RPC and admin secrets

1. Update the SOPS values.
2. Apply the Garage role.
3. Verify the admin API and layout.
4. Elasticsearch does not use these secrets; it uses the S3 key only.

### Rotate the Cloudflare DNS API token

1. Create a new scoped token in Cloudflare for the zone.
2. Update `secret_nginx_cloudflare_api_token` with `sops`.
3. Apply the NGINX role; this rewrites `/etc/letsencrypt/cloudflare.ini`.
4. Run `certbot renew --dry-run` or wait for the renewal timer.
5. Revoke the old token in Cloudflare.

### Rotate the OpenTofu state passphrase

Rotating the passphrase requires a reviewed change to `scripts/tofu.sh` or
`TF_ENCRYPTION`, because the current wrapper defines one key provider and one
method. Do not overwrite the passphrase in place.

1. Generate a new passphrase.
2. Add a new PBKDF2 key provider and AES-GCM method with a fallback to the
   current method.
3. Run a state read/write so OpenTofu rewrites the state under the new method.
4. Verify a plan can read the state.
5. Remove the fallback and the old passphrase after the new state is verified.
6. Update `tofu_state_passphrase` in `tofu/<env>.sops.yml`.

### Rotate an age identity

1. Generate the new age key.
2. Add the new public recipient to the matching rule.
3. Run `sops updatekeys` on every affected file.
4. Verify decryption with the new key.
5. Remove the old recipient.
6. Revoke and destroy the old private key.
7. Record the rotation in the change log.

### Compromise response

1. Revoke the age key and remove its recipient.
2. Re-encrypt affected files with the replacement key.
3. Rotate every credential in the affected environment.
4. Review git history, CI logs, and host logs for exposure.
5. Document the incident and the recovery steps.

An encrypted file in git history remains decryptable by anyone who retains the
old private key. Removing a recipient does not rewrite history; rotate the
underlying credentials.

## Secret scanning

- GitHub push protection and secret scanning are enabled.
- CI runs `gitleaks` on every change.
- Age private keys (`AGE-SECRET-KEY-1...`) and plaintext private key blocks are
  forbidden.
- SOPS ciphertext (`ENC[AES256_GCM,...]`) is expected and must not be allowlisted
  as a plaintext exception.
- Test fixtures must not contain values that resemble production credentials.

## Adding a new secret

1. Add the `secret_*` key to each environment's encrypted file.
2. Map it to a role variable in the same encrypted file.
3. Declare the role variable in `meta/argument_specs.yml` with `no_log: true`.
4. Add `no_log` to tasks that use it.
5. Document the secret and its rotation procedure in the component document.
6. Generate test values at runtime; never commit a test secret.
