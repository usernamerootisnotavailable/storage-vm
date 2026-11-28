provider "proxmox" {
  endpoint  = ephemeral.sops_file.tofu.data["proxmox_endpoint"]
  api_token = "${ephemeral.sops_file.tofu.data["proxmox_api_token_id"]}=${ephemeral.sops_file.tofu.data["proxmox_api_token_secret"]}"
  insecure  = tobool(ephemeral.sops_file.tofu.data["proxmox_insecure"])
}
