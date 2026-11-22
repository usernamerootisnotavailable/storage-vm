# Secrets with SOPS and age

## Model

- Secrets are encrypted with [SOPS](https://getsops.io/) 3.12 or newer using age recipients.
- Encrypted files are committed to git. Plaintext secret files are never committed.
- Each environment has its own age recipient and private identity.
- The development key must not decrypt production files, and vice versa.
- Decryption happens on the controller. Managed hosts never receive an age key.
- Ansible loads encrypted variables through the `community.sops.sops` vars plugin.

## Repository layout

```text
.sops.yaml                                      Creation rules and public recipients
inventories/dev/group_vars/storage/secrets.sops.yml
inventories/prod/group_vars/storage/secrets.sops.yml
```

The plugin only loads files ending in `.sops.yml`, `.sops.yaml`, or `.sops.json`. An unencrypted file with one of those extensions causes an error.

## `.sops.yaml`

The repository ships with `creation_rules: []` because no age recipients exist yet. Add one rule per environment:

```yaml
creation_rules:
  - path_regex: inventories/dev/.*\.sops\.ya?ml$
    age: age1devrecipient...
  - path_regex: inventories/prod/.*\.sops\.ya?ml$
    age: age1prodrecipient...
```

Rules are evaluated in order; the first match wins. Paths are relative to `.sops.yaml`. The file must be named exactly `.sops.yaml`; SOPS does not auto-discover `.sops.yml`.

Security review is required for any change to `.sops.yaml`. Adding a recipient grants that identity read access to every file matching the rule.

## Key custody

Generate one age identity per environment:

```bash
mkdir -p ~/.config/sops/age
age-keygen -o ~/.config/sops/age/dev.keys.txt
age-keygen -o ~/.config/sops/age/prod.keys.txt
chmod 600 ~/.config/sops/age/*.keys.txt
```

The command prints the public recipient (`age1...`). Add only the public recipient to `.sops.yaml`.

- Never store private keys in the repository, an inventory, CI logs, or a managed host.
- Never put both environment keys in the default `~/.config/sops/age/keys.txt`; use separate files selected by `SOPS_AGE_KEY_FILE`.
- Back up each private key offline. Losing a production key means losing the ability to decrypt existing files unless the plaintext is recoverable elsewhere.
- Production key access is restricted to operators and the protected GitHub `prod` environment.
- Development keys may be shared among developers, but must still remain outside the repository.

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

## Creating secrets

1. Add the environment recipient to `.sops.yaml`.
2. Run the bootstrap script:

```bash
./scripts/init-secrets.sh dev
```

The script:

- Generates random values with `openssl`.
- Writes a temporary plaintext file with mode `0600`.
- Encrypts it to `inventories/<env>/group_vars/storage/secrets.sops.yml`.
- Removes the temporary file on exit.
- Refuses to overwrite an existing secrets file.

To edit an existing file:

```bash
sops inventories/dev/group_vars/storage/secrets.sops.yml
```

SOPS opens a temporary decrypted file in the editor, re-encrypts on save, and removes the temporary file. Edit only on a trusted workstation.

Never run:

```bash
sops --decrypt file.sops.yml > plaintext.yml
```

## Variable naming

Only secrets belong in `secrets.sops.yml`. Every value is prefixed with `secret_`:

```yaml
secret_postgresql_app_password: "..."
secret_garage_admin_token: "..."
secret_elasticsearch_keystore_password: "..."
```

Map them to role variables in `group_vars/storage/main.yml`:

```yaml
postgresql_app_password: "{{ secret_postgresql_app_password }}"
```

Do not use `secret_*` names inside roles. Roles consume the mapped variables.

## Output protection

`ansible.cfg` enables:

```ini
[community.sops]
register_values_as_secrets = True
handle_unencrypted_files = error
```

`register_values_as_secrets` marks every value loaded from a SOPS file as secret and redacts it from Ansible output. This requires ansible-core 2.22 or newer.

Masking is defense in depth, not permission to print secrets:

- Add `no_log: true` to tasks that pass passwords to modules or commands.
- Set `diff: false` on templates or files that contain secrets.
- Do not use `debug: var` on variables derived from secrets.
- Do not pass secrets on command lines where they appear in `ps`.
- Do not enable `log_path` in `ansible.cfg`.

## CI and GitHub Actions

- Each GitHub Environment (`dev`, `prod`) stores its age private key as `SOPS_AGE_KEY`.
- The production environment requires reviewers and restricts deployments to `main`.
- Fork pull requests never receive environment secrets. Lint and Molecule must run without them.
- Integration tests that need a secret generate an ephemeral value at runtime; they do not use production secrets.
- Do not echo secrets, enable shell tracing around decryption, or upload decrypted artifacts.

## Rotation

### Rotate a secret value

1. Change the value with `sops`.
2. Apply the role with the appropriate tag.
3. Verify the service accepts the new credential.
4. Revoke the old credential at the source.

For PostgreSQL, password changes are skipped by default to preserve idempotence. Set `postgresql_rotate_passwords: true` for the rotation run, then return it to `false`.

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

An encrypted file in git history remains decryptable by anyone who retains the old private key. Removing a recipient does not rewrite history; rotate the underlying credentials.

## Secret scanning

- GitHub push protection and secret scanning are enabled.
- CI runs `gitleaks` on every change.
- Age private keys (`AGE-SECRET-KEY-1...`) and plaintext private key blocks are forbidden.
- SOPS ciphertext (`ENC[AES256_GCM,...]`) is expected and must not be allowlisted as a plaintext exception.
- Test fixtures must not contain values that resemble production credentials.

## Adding a new secret

1. Add a `secret_*` key to each environment's SOPS file.
2. Map it to a role variable in `main.yml`.
3. Declare the role variable in `meta/argument_specs.yml` with `no_log: true`.
4. Add `no_log` to tasks that use it.
5. Document the secret and its rotation procedure in the component document.
6. Generate test values at runtime; never commit a test secret.
