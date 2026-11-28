output "environment" {
  description = "OpenTofu workspace that produced this VM."
  value       = terraform.workspace
}

output "vm_id" {
  description = "Auto-assigned Proxmox VM ID."
  value       = proxmox_virtual_environment_vm.storage.vm_id
}

output "vm_name" {
  description = "Proxmox VM name, which is also the cloud-init hostname."
  value       = proxmox_virtual_environment_vm.storage.name
  sensitive   = true
}
