terraform {
  required_version = "1.12.12"

  required_providers {
    proxmox = {
      source  = "bpg/proxmox"
      version = "0.124.0"
    }
    sops = {
      source  = "carlpett/sops"
      version = "1.4.1"
    }
  }

  # The key provider and method are supplied through TF_ENCRYPTION by
  # scripts/tofu.sh. enforced = true refuses to read or write plaintext state
  # or plans when the environment configuration is absent.
  encryption {
    state {
      enforced = true
    }
    plan {
      enforced = true
    }
  }
}
