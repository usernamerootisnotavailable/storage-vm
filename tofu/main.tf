data "sops_file" "infrastructure" {
  source_file = abspath("${path.module}/../inventories/${terraform.workspace}/group_vars/all/infrastructure.sops.yml")
}

ephemeral "sops_file" "tofu" {
  source_file = abspath("${path.module}/${terraform.workspace}.sops.yml")
}

locals {
  infrastructure = data.sops_file.infrastructure.data

  ansible_host   = local.infrastructure["ansible_host"]
  vm_name        = local.infrastructure["storage_vm_name"]
  node_name      = local.infrastructure["proxmox_node_name"]
  storage_id     = local.infrastructure["proxmox_storage_id"]
  template_vmid  = tonumber(local.infrastructure["proxmox_template_vmid"])
  bridge         = local.infrastructure["proxmox_bridge"]
  cores          = tonumber(local.infrastructure["storage_vm_cores"])
  memory_mb      = tonumber(local.infrastructure["storage_vm_memory_mb"])
  disk_gb        = tonumber(local.infrastructure["storage_vm_disk_gb"])
  cpu_type       = local.infrastructure["storage_vm_cpu_type"]
  prefix_length  = tonumber(local.infrastructure["storage_vm_ipv4_prefix_length"])
  gateway        = local.infrastructure["storage_vm_ipv4_gateway"]
  ssh_public_key = local.infrastructure["storage_vm_ssh_public_key"]
  start_on_boot  = tobool(local.infrastructure["storage_vm_start_on_boot"])
  ipv4_cidr      = "${local.ansible_host}/${local.prefix_length}"

  dns_servers = [
    for server in split(",", local.infrastructure["storage_vm_dns_servers"]) :
    trimspace(server) if trimspace(server) != ""
  ]

  tags = [
    for tag in split(",", local.infrastructure["storage_vm_tags"]) :
    trimspace(tag) if trimspace(tag) != ""
  ]
}

check "infrastructure_values" {
  assert {
    condition     = can(cidrhost(local.ipv4_cidr, 0))
    error_message = "ansible_host and storage_vm_ipv4_prefix_length must form a valid CIDR address."
  }

  assert {
    condition     = local.prefix_length >= 1 && local.prefix_length <= 32
    error_message = "storage_vm_ipv4_prefix_length must be between 1 and 32."
  }
}

resource "proxmox_virtual_environment_vm" "storage" {
  name        = local.vm_name
  description = "Managed by OpenTofu workspace ${terraform.workspace}"
  tags        = sort(local.tags)
  node_name   = local.node_name

  bios          = "ovmf"
  machine       = "q35"
  scsi_hardware = "virtio-scsi-single"

  started         = true
  on_boot         = local.start_on_boot
  stop_on_destroy = true

  clone {
    vm_id        = local.template_vmid
    full         = true
    datastore_id = local.storage_id
  }

  agent {
    enabled = true
    timeout = "15m"

    # The handoff waits for SSH directly. Do not make plan/apply wait for the
    # guest agent to report an address.
    wait_for_ip {
      disabled = true
    }
  }

  cpu {
    cores   = local.cores
    sockets = 1
    type    = local.cpu_type
  }

  memory {
    dedicated = local.memory_mb
  }

  disk {
    datastore_id = local.storage_id
    interface    = "scsi0"
    size         = local.disk_gb
    discard      = "on"
    iothread     = true
    file_format  = "raw"
  }

  efi_disk {
    datastore_id      = local.storage_id
    type              = "2m"
    pre_enrolled_keys = false
  }

  initialization {
    datastore_id = local.storage_id
    interface    = "ide2"

    dns {
      servers = local.dns_servers
    }

    ip_config {
      ipv4 {
        address = local.ipv4_cidr
        gateway = local.gateway
      }
    }

    user_account {
      username = "ansible"
      keys     = [local.ssh_public_key]
    }
  }

  network_device {
    bridge = local.bridge
    model  = "virtio"
  }

  operating_system {
    type = "l26"
  }
}
