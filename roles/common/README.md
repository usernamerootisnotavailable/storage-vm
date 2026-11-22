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
  - 10.20.0.0/16
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

- `common_manage_time` and `common_firewall_enabled` are capability flags. They are false only in the Docker development harness.
- SELinux is never set permissive or disabled by this role.
- The automation user must exist before SSH hardening is applied. It is provisioned outside this role.
