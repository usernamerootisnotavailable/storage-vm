# Variables

## Principles

- A role owns its interface. Every input is documented in `meta/argument_specs.yml` and the role README.
- Role defaults are safe, complete, and environment-neutral.
- Inventory supplies only values that differ from the defaults.
- Environment identity never controls behavior.
- Secrets are never defaults.
- Units are part of the variable name.

## Naming

Use:

```text
<component>_<noun>_<unit>
```

Examples:

```yaml
postgresql_port: 5432
postgresql_max_connections: 100
postgresql_shared_buffers: "256MB"
postgresql_backup_retention_days: 7
common_ssh_permit_root_login: "no"
```

Rules:

- `snake_case` only.
- Prefix every role variable with the role name (`common_`, `postgresql_`, `mariadb_`, `garage_`, `elasticsearch_`, `nginx_`).
- Include units for time, size, and rates: `_seconds`, `_mb`, `_days`, `_cidrs`.
- Use `_enabled` for booleans.
- Use `_path` for filesystem paths, `_url` for URLs, `_cidrs` for CIDR lists.
- Use the `storage_` prefix for shared cross-service values and `secret_` only in SOPS files.
- Use plural names for lists and mappings.
- Do not include environment names, hostnames, or regions in variable names.
- Do not abbreviate words that are unclear.

## Precedence

The supported layers, lowest to highest:

1. `roles/<role>/defaults/main.yml`
2. `inventories/<env>/group_vars/all/main.yml`
3. `inventories/<env>/group_vars/all/versions.yml`
4. `inventories/<env>/group_vars/all/environment.sops.yml`
5. `inventories/<env>/host_vars/<host>/main.yml`
6. Test-only runtime overrides (`--extra-vars` from an ephemeral file)

Files in the same group_vars directory are loaded in lexical order. Do not
duplicate a key between `main.yml`, `versions.yml`, and `environment.sops.yml`;
the later file would silently win.

Do not use:

- Play-level `vars:`
- `set_fact` for configuration
- `include_vars` from environment-specific paths
- `group_vars` at the repository root
- `hostvars` reach-through for configuration

`set_fact` is allowed only for runtime capability detection, such as whether SELinux is enforcing. Document every such use.

## Where a value goes

| Question | Location |
|---|---|
| Is this a safe default for every environment? | Role `defaults/main.yml` |
| Is this environment metadata or a test-harness capability flag? | `inventories/<env>/group_vars/all/main.yml` |
| Is this environment-specific sizing, endpoint, CIDR, domain, or feature choice? | `inventories/<env>/group_vars/all/environment.sops.yml` |
| Is this a component version? | `inventories/<env>/group_vars/all/versions.yml` |
| Is this a credential? | `inventories/<env>/group_vars/all/environment.sops.yml` |
| Is this only true for one physical host? | `inventories/<env>/host_vars/<host>/main.yml` |
| Is this a connection parameter? | `inventories/<env>/group_vars/all/environment.sops.yml` |
| Is this only for lint, syntax, or CI? | `inventories/ci/` |

If a value is set in more than one of these layers, remove the duplicate. Two exceptions are allowed:

- Security-critical production settings may be explicit even when they match a secure default.
- A required empty placeholder may be shown with a comment so the operator must replace it.

## Environment independence

Forbidden:

```yaml
when: deployment_environment == "prod"
when: inventory_dir is search("prod")
when: ansible_hostname == "storage01"
postgresql_shared_buffers: "{{ '8GB' if deployment_environment == 'prod' else '256MB' }}"
```

Allowed:

```yaml
# Different sizing through the same variable
postgresql_shared_buffers: "8GB"

# Different exposure through the same variable
postgresql_apps:
  - state: present
    name: app
    user: app
    password: "{{ secret_postgresql_app_password }}"
    databases:
      - appdb
    cidrs:
      - 192.0.2.0/24
```

Capability flags for the test harness are explicit and named for the capability, not the environment:

```yaml
common_manage_time: false           # disabled in the development container
common_firewall_enabled: false      # disabled in the development container
common_require_selinux: false       # SELinux is not enforced inside Docker
elasticsearch_manage_sysctl: false  # the Docker host provides vm.max_map_count
```

These flags must never be used to weaken production. They are documented in `docs/ENVIRONMENTS.md`.

## Required values and validation

Use `meta/argument_specs.yml` for types, required fields, choices, and nesting. Example:

```yaml
argument_specs:
  main:
    short_description: Configure PostgreSQL 18
    options:
      postgresql_apps:
        type: list
        elements: dict
        options:
          password:
            type: str
            required: true
            no_log: true
          state:
            type: str
            required: true
            choices: [present, absent]
      postgresql_tls_mode:
        type: str
        choices: [generated, provided]
        default: generated
```

Use `ansible.builtin.assert` for invariants that argument specs cannot express:

```yaml
- name: Validate external access configuration
  ansible.builtin.assert:
    that:
      - >-
        postgresql_apps | selectattr('state', 'equalto', 'present')
        | map(attribute='cidrs') | flatten | length == 0 or
        postgresql_listen_addresses not in ['127.0.0.1', 'localhost']
    fail_msg: >-
      Set postgresql_listen_addresses to a reachable address when external
      applications are defined.
```

Assertions must explain the fix, not just state that a value is invalid.

## Shared service contracts

Cross-service values use explicit shared names rather than `hostvars` reach-through:

```yaml
storage_s3_endpoint: "http://127.0.0.1:3900"
storage_s3_region: "garage"
storage_s3_bucket: "elasticsearch-snapshots"
storage_s3_access_key: "{{ secret_storage_s3_access_key }}"
storage_s3_secret_key: "{{ secret_storage_s3_secret_key }}"
```

Garage and Elasticsearch consume these values. NGINX uses the Elasticsearch CA path for upstream verification. A role may default to a shared variable only with a safe fallback, and must document the contract in its README.

Let's Encrypt mode also consumes `secret_nginx_cloudflare_api_token` through the `nginx_cloudflare_api_token` mapping. Generated certificate mode does not.

## Database application contracts

See [Database applications](DATABASES.md) for the normative cross-engine policy
on ownership, lifecycle, secrets, network exposure, TLS, and verification.

PostgreSQL and MariaDB use explicit application lists. The storage host owns
accounts, databases, grants, TLS requirements, and firewall exposure; app
deployments own migrations and connectivity. Do not add raw authentication or
grant configuration outside these lists.

MariaDB applications use:

```yaml
mariadb_apps:
  - state: present
    name: app
    user: app
    password: "{{ secret_mariadb_app_password }}"
    databases:
      - appdb
    cidrs:
      - 127.0.0.1/32
```

MariaDB has no `pg_hba.conf`. Its network scope is the account host derived from
`cidrs` plus database grants in `mysql.db`. Exact IPv4 `/32` and IPv6 `/128`
sources become exact account hosts; broader IPv4 CIDRs use
`network/netmask`. Broader IPv6 CIDRs are rejected because MariaDB netmask
syntax is IPv4-only. Every present account requires SSL.

`mariadb_apps` entries have no extension or connection-limit fields. Use
`postgresql_apps` for those PostgreSQL-only features.

## Versions

- Versions live in `inventories/<env>/group_vars/all/versions.yml`.
- Pin full versions where the vendor artifact is version-specific: MariaDB, Garage, Elasticsearch, and NGINX.
- Pin PostgreSQL by major version and record the tested patch.
- Garage requires both a version and its SHA256 checksum.
- Never use `latest`, `*`, or an unpinned image tag.
- Development and production must use the same versions except during a documented staged rollout.
- A version change is a separate, reviewable change with a backup and rollback plan.
- Record the exact package version tested in `docs/COMPONENTS.md`.

## Secrets

Secret values are named `secret_*` inside
`inventories/<env>/group_vars/all/environment.sops.yml` and mapped to normal
variables in the same encrypted file:

```yaml
# environment.sops.yml (encrypted)
secret_postgresql_app_password: "..."
secret_mariadb_app_password: "..."

postgresql_apps:
  - state: present
    name: app
    user: app
    password: "{{ secret_postgresql_app_password }}"
    databases:
      - appdb
    cidrs:
      - 127.0.0.1/32

mariadb_apps:
  - state: present
    name: app
    user: app
    password: "{{ secret_mariadb_app_password }}"
    databases:
      - appdb
    cidrs:
      - 127.0.0.1/32
```

The Proxmox API token and OpenTofu state passphrase live in
`tofu/<env>.sops.yml`, not in the Ansible inventory.

Do not use `secret_*` names in roles. Roles consume the mapped variable, which
keeps the role independent of the secret backend.

See `docs/SECRETS.md`.

## Deprecation

To rename a variable:

1. Add the new variable with a default.
2. Map the old variable to the new one for one release.
3. Emit an `ansible.builtin.warning` when the old variable is set.
4. Remove the old variable after all inventories migrate.
5. Document the change in the component README.

Do not silently remove a variable that inventory still sets.

## Review checklist

- Does the role have a prefix on every variable?
- Is every variable in `argument_specs`?
- Is every secret in a SOPS file?
- Is any environment name used in logic?
- Is any value duplicated across layers?
- Is a version unpinned?
- Are units and types clear?
