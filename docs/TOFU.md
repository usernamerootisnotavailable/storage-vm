# OpenTofu VM provisioning

## Purpose

`tofu/` creates one storage VM per environment from the AL10 base-image
template, then hands the VM to Ansible for configuration. The OpenTofu layer
only creates the VM, cloud-init identity, network settings, and disk sizing. It
does not install or configure services.

The base-image contract is in the
[AL10 base image repository](https://github.com/usernamerootisnotavailable/AL10-base-image):
`ansible` is the cloud-init user, password login is disabled, the SSH key is
injected per clone, the template uses OVMF/q35/virtio-scsi-single, and the root
filesystem grows on first boot.

## Pinned versions

| Tool | Version |
|---|---|
| OpenTofu | `1.12.12` |
| `bpg/proxmox` | `0.124.0` |
| `carlpett/sops` | `1.4.1` |
| TFLint | `0.66.0` |

Provider selections and checksums are committed in
`tofu/.terraform.lock.hcl`. OpenTofu itself and TFLint are pinned in the
Makefile and CI.

## Layout

```text
tofu/
  versions.tf
  providers.tf
  main.tf
  outputs.tf
  .tflint.hcl
  .terraform.lock.hcl
  dev.sops.yml
  dev.sops.yml.example
  prod.sops.yml
  prod.sops.yml.example
  terraform.tfstate.d/          local, gitignored
```

`tofu/<env>.sops.yml` contains only:

- `proxmox_endpoint`
- `proxmox_api_token_id`
- `proxmox_api_token_secret`
- `proxmox_insecure`
- `tofu_state_passphrase`

It is read through `ephemeral "sops_file"`, so the token and passphrase are not
written to state. The state passphrase must be 64 lowercase hex characters;
`scripts/tofu.sh` rejects anything else before building `TF_ENCRYPTION`.

Shared VM and placement values are in
`inventories/<env>/group_vars/all/infrastructure.sops.yml`. That file contains
no passwords. Ansible loads it normally, and OpenTofu reads it through
`data "sops_file"`:

- `ansible_host`, `ansible_port`, `ansible_user`, SSH connection paths
- `proxmox_node_name`, `proxmox_storage_id`, `proxmox_template_vmid`,
  `proxmox_bridge`
- `storage_vm_name`, `storage_vm_cores`, `storage_vm_memory_mb`,
  `storage_vm_disk_gb`, `storage_vm_cpu_type`
- `storage_vm_ipv4_prefix_length`, `storage_vm_ipv4_gateway`,
  `storage_vm_dns_servers`
- `storage_vm_ssh_public_key`, `storage_vm_start_on_boot`,
  `storage_vm_tags`

`storage_vm_name` is also the cloud-init hostname. Keep it equal to the logical
hostname (`storage01`).

## State and workspaces

- One workspace per environment: `dev` and `prod`.
- The local backend stores state under `tofu/terraform.tfstate.d/<env>/`.
- State and plan files are encrypted with OpenTofu native encryption using
  `aes_gcm`, with a PBKDF2 key derived from `tofu_state_passphrase`.
- `enforced = true` is set in `versions.tf`. OpenTofu refuses to write plaintext
  state or plan data if `TF_ENCRYPTION` is missing.
- `scripts/tofu.sh` decrypts the passphrase from
  `tofu/<env>.sops.yml` and builds `TF_ENCRYPTION` in memory for `plan` and
  `apply`. It never prints the passphrase.
- Init and validate do not need the real passphrase. They use a throwaway
  in-memory passphrase because the module enforces encryption; no state is
  written by those commands.
- State files, plan files, and `.terraform/` are gitignored. The provider lock
  file is committed.

## Commands

All commands require `ENV`:

```bash
make tf-init ENV=dev
make tf-fmt ENV=dev
make tf-validate ENV=dev
make tf-lint ENV=dev
make tf-check ENV=dev
make tf-plan ENV=dev
make tf-apply ENV=dev
```

`make tf-init` downloads the pinned providers and writes or updates
`.terraform.lock.hcl`. `make tf-plan` selects or creates the `dev` workspace and
requires the dev age key plus the generated encrypted files. `make tf-apply`
runs interactively; review the plan first.

The underlying wrapper also accepts arguments:

```bash
./scripts/tofu.sh dev plan -out=dev.tfplan
./scripts/tofu.sh dev apply dev.tfplan
```

## First-run sequence

See [`docs/HANDOFF.md`](HANDOFF.md) for the full first-VM handoff, including
the first Ansible connection as `ansible`.

1. Create the AL10 template VM in Proxmox and record its VMID.
2. Create a Proxmox API token with permission to allocate and configure VMs and
   allocate space on the target datastore. Put the endpoint and token in
   `tofu/<env>.sops.yml` with `sops`.
3. Put the template VMID, node, storage, bridge, VM sizing, static network,
   and SSH public key in
   `inventories/<env>/group_vars/all/infrastructure.sops.yml` with `sops`.
4. Run `make tf-init ENV=<env>`, then `make tf-plan ENV=<env>`. Review the plan.
5. Run `make tf-apply ENV=<env>`.
6. Wait for the VM to boot and accept SSH as `ansible`.
7. Populate the controller `known_hosts` with `ssh-keyscan` on first boot. Do not
   copy host keys from the template; the image regenerates them.
8. Run `ansible-playbook -i inventories/<env>/hosts.yml site.yml` and
   `playbooks/verify.yml`.

The OpenTofu resource sets the VM disk size before first boot, so cloud-init can
grow the root filesystem. The guest agent is enabled, but the provider does not
wait for it to report an address; the handoff waits for SSH instead.

## Verification status

- `tofu fmt -check`, `tofu validate`, and TFLint pass.
- A scratch plan with synthetic values validated the module, `sops_file` data
  source, ephemeral credentials, and encrypted plan output.
- No real plan or apply was run against `dev`, `prod`, or a Proxmox endpoint.
- No state file has been created in the repository.

## Troubleshooting

| Symptom | Check |
|---|---|
| `OpenTofu v1.12.12 is required` | Install the pinned binary or set `TOFU_BIN` |
| `Age key not found` | Set `SOPS_AGE_KEY_FILE` or create the environment key |
| `OpenTofu secret file not found` | Run `make generate ENV=<env>` for that environment |
| `tofu_state_passphrase must be 64 lowercase hex characters` | Recreate the value with `sops` |
| Provider authentication fails | Proxmox endpoint, token ID/secret, token permissions, and `proxmox_insecure` |
| Clone cannot find the template | `proxmox_template_vmid`, node, and storage ID |
| Root filesystem is not resized | The disk size must be set before the first boot |
| SSH host key mismatch | Re-run `ssh-keyscan` after the first boot |
