# 1.3 GCS artifacts bucket.
#
# Object layout (per data-model-and-api-contract.md §7):
#   gs://<bucket>/<tenantId>/<projectId>/<sessionId>/<type>/<seq>.<ext>
#   dom_chunk   -> .../dom/<seq>.json.gz
#   screenshot  -> .../shots/<seq>.webp
#
# Uploads use per-object V4 signed PUT URLs minted by the backend (D27); the
# bucket itself is private (uniform bucket-level access, no public ACLs).

variable "project_id" {
  type = string
}

variable "region" {
  type = string
}

variable "name_prefix" {
  type = string
}

variable "labels" {
  type = map(string)
}

resource "google_storage_bucket" "artifacts" {
  project  = var.project_id
  name     = "${var.name_prefix}-artifacts-${var.project_id}"
  location = var.region

  # Uniform bucket-level access: no per-object ACLs, IAM-only authorization.
  uniform_bucket_level_access = true

  # Versioning keeps prior object generations as a safety net against
  # accidental overwrite of an artifact path.
  versioning {
    enabled = true
  }

  # Retention is INDEFINITE by default per design D16: there is intentionally
  # NO lifecycle / auto-expiry rule here. Artifacts live until explicit session
  # deletion, which the backend purge job performs by deleting the session
  # object prefix (contract §3.10). Do not add a lifecycle_rule that expires
  # objects by age without revisiting D16.

  # Block all public access defensively.
  public_access_prevention = "enforced"

  labels = var.labels
}

output "bucket_name" {
  value = google_storage_bucket.artifacts.name
}

output "bucket_url" {
  value = google_storage_bucket.artifacts.url
}

output "bucket_self_link" {
  value = google_storage_bucket.artifacts.self_link
}
