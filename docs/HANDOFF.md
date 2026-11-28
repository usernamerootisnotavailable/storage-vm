# First VM handoff

This is the order of operations for the first VM in an environment. The agent
does not run any of these commands against a real Proxmox host or a deployment
environment.

## 1. Prepare inputs

1. Build the AL10 template VM and record its VMID.
2. Create a Proxmox API token that can allocate and configure VMs and allocate
   space on the target datastore.
3. Run `make generate ENV=<dev|prod>` and add the printed public recipient to
   `.sops.yaml`.
4. Edit the encrypted files with `sops`:

```bash
sops inventories/<env>/group_vars/all/environment.sops.yml
sops inventories/<env>/group_vars/all/infrastructure.sops.yml
sops tofu/<env>.sops.yml
```

The infrastructure file contains no passwords. It holds the template VMID,
node, storage, bridge, VM sizing, static address, DNS, and SSH public key. The
OpenTofu file holds the Proxmox endpoint, token, and state passphrase.

## 2. Create the VM

```bash
make tf-init ENV=<env>
make tf-fmt ENV=<env>
make tf-validate ENV=<env>
make tf-lint ENV=<env>
make tf-plan ENV=<env>
```

Review the plan, then:

```bash
make tf-apply ENV=<env>
```

The apply starts the VM. It sets the VM name, which is also the cloud-init
hostname. The base image supplies the `ansible` account and its passwordless
sudo rule; cloud-init injects the public SSH key.

## 3. Wait for SSH as `ansible`

Do not use a template host key. The image regenerates SSH host keys on first
boot. Resolve the address and port from the encrypted infrastructure file
without printing them:

```bash
export SOPS_AGE_KEY_FILE="$HOME/.config/sops/age/<env>.keys.txt"
host="$(sops --decrypt --extract '["ansible_host"]' \
  inventories/<env>/group_vars/all/infrastructure.sops.yml)"
port="$(sops --decrypt --extract '["ansible_port"]' \
  inventories/<env>/group_vars/all/infrastructure.sops.yml)"
ssh-keyscan -p "$port" "$host" >> "$HOME/.ssh/known_hosts"
unset host port
```

Then verify the first connection as `ansible`:

```bash
ansible -i inventories/<env>/hosts.yml storage -m ansible.builtin.ping
ansible -i inventories/<env>/hosts.yml storage \
  -m ansible.builtin.command -a 'sudo -n true'
```

The `common` role verifies the account, its authorized key, its login shell, and
passwordless sudo on every run.

## 4. Deploy with Ansible

```bash
ansible-playbook -i inventories/<env>/hosts.yml site.yml --check --diff
ansible-playbook -i inventories/<env>/hosts.yml site.yml
ansible-playbook -i inventories/<env>/hosts.yml playbooks/verify.yml
```

Production requires approval, a backup, the production age key, and a reviewed
plan. Before applying, make sure the operator and automation source networks are
inside `common_firewall_allowed_ssh_cidrs`. The first Ansible run removes the
broad SSH allowance and replaces it with source-CIDR rules.

## 5. CI checks

The CI workflow runs without real credentials:

- lint, policy, literal, and syntax checks with `inventories/ci`
- gitleaks over git history
- Molecule for every role
- full-stack integration on the CI inventory with ephemeral test secrets
- OpenTofu init, format, validate, and TFLint with a throwaway encryption
  passphrase and no Proxmox token

CI does not run `tofu plan` or `tofu apply`, does not decrypt the committed
environment files, and never receives the Proxmox token or state passphrase.
