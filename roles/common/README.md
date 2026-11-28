# common

Applies the AlmaLinux 10 baseline for the storage host.

## Responsibilities

- Verify AlmaLinux 10
- Install baseline packages
- Set the timezone and optionally configure chrony
- Create administrator accounts and optional SSH keys/sudo
- Harden SSH through a managed drop-in
- Configure firewalld with explicit SSH source CIDRs
- Enable persistent journald logging
- Enforce SELinux when the host reports it is enabled

## Required variables

None. All defaults are safe for a host that already has a bootstrap automation user with SSH and sudo.

For production, set:

```yaml
common_firewall_enabled: true
common_firewall_allowed_ssh_cidrs:
  - 192.0.2.0/24
common_ssh_allow_users:
  - ansible
```

The role refuses to configure firewalld with an empty SSH CIDR list.

## Example

```yaml
- hosts: storage
  become: true
  roles:
    - role: common
```

## Notes

- `common_automation_user` defaults to the image-managed `ansible` account. The
  role verifies the account exists with a login shell, has an authorized key,
  and still has passwordless sudo. It refuses to manage that account through
  `common_admin_users`.
- `common_verify_automation_key` defaults to true. Service-role Molecule
  scenarios set it to false because their container is not provisioned by
  cloud-init; the `common` scenario creates an ephemeral test key instead.
- `common_manage_time`, `common_firewall_enabled`, and
  `common_require_selinux` are capability flags. They are disabled only in the
  Docker development/CI harness, where the host kernel controls those
  facilities.
- SELinux is never set permissive or disabled by this role. In production, `common_require_selinux` defaults to true and fails the run if SELinux is disabled.
- The automation user must exist before SSH hardening is applied. It is
  provisioned by the base image and cloud-init, outside this role.
