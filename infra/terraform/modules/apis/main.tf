# 1.2 Enable the GCP service APIs the stack depends on.
# disable_on_destroy = false so tearing down the stack does not disable
# project-wide APIs that other workloads might share.

variable "project_id" {
  type = string
}

locals {
  services = [
    "run.googleapis.com",
    "sqladmin.googleapis.com",
    "identitytoolkit.googleapis.com",
    "secretmanager.googleapis.com",
    "storage.googleapis.com",
    "iam.googleapis.com",
    "cloudtasks.googleapis.com",
    "artifactregistry.googleapis.com",
    # Supporting APIs required by the above:
    "iamcredentials.googleapis.com", # workload identity / token minting (signed URLs, WIF)
    "sts.googleapis.com",            # security token service (WIF token exchange)
    "cloudresourcemanager.googleapis.com",
    "serviceusage.googleapis.com",
  ]
}

resource "google_project_service" "this" {
  for_each = toset(local.services)

  project            = var.project_id
  service            = each.value
  disable_on_destroy = false
}

output "enabled_services" {
  value = [for s in google_project_service.this : s.service]
}

# Aggregate dependency handle: other modules depend_on this to ensure APIs
# are enabled before resources that need them are created.
output "ready" {
  value = join(",", sort([for s in google_project_service.this : s.service]))
}
