# 1.4 Secret Manager secrets.
#
# - gemini-api-key: the one standing platform secret (D25). Stored here, injected
#   into Cloud Run at runtime, never in code/config/PostgreSQL.
# - Project Jira tokens and project default-creds are created at RUNTIME by the
#   backend (one secret per project, referenced by `token_secret_ref` /
#   `default_creds_secret_ref` in PostgreSQL). We do NOT pre-create those here;
#   instead we grant the runtime service account permission to create and access
#   secrets that follow the documented naming convention (see iam module).
#
# The placeholder "jira-tokens-structure" secret below documents the expected
# per-project Jira secret shape for operators; it carries no real value.

variable "project_id" {
  type = string
}

variable "name_prefix" {
  type = string
}

variable "region" {
  type = string
}

variable "labels" {
  type = map(string)
}

variable "gemini_api_key" {
  description = "Optional initial value. Empty means create the container without a version."
  type        = string
  default     = ""
  sensitive   = true
}

# --- Gemini Developer API key (platform secret) ---------------------------
resource "google_secret_manager_secret" "gemini_api_key" {
  project   = var.project_id
  secret_id = "${var.name_prefix}-gemini-api-key"

  replication {
    user_managed {
      replicas {
        location = var.region
      }
    }
  }

  labels = var.labels
}

# Only create an initial version if a value was supplied. The recommended flow
# is to leave it empty and add the version out of band so the key never lands
# in terraform state from a tfvars file.
resource "google_secret_manager_secret_version" "gemini_api_key" {
  count = var.gemini_api_key == "" ? 0 : 1

  secret      = google_secret_manager_secret.gemini_api_key.id
  secret_data = var.gemini_api_key
}

# --- Documentation-only placeholder for per-project Jira token structure ---
# This secret is never read by the app. It exists so operators can see the
# expected JSON shape for the per-project Jira secrets the backend creates at
# runtime (secret_id convention: "<name_prefix>-jira-<projectId>").
resource "google_secret_manager_secret" "jira_tokens_structure" {
  project   = var.project_id
  secret_id = "${var.name_prefix}-jira-tokens-structure"

  replication {
    user_managed {
      replicas {
        location = var.region
      }
    }
  }

  labels = merge(var.labels, { purpose = "documentation-placeholder" })
}

resource "google_secret_manager_secret_version" "jira_tokens_structure" {
  secret = google_secret_manager_secret.jira_tokens_structure.id
  secret_data = jsonencode({
    _doc          = "Per-project Jira secret shape. Backend creates one secret per project: ${var.name_prefix}-jira-<projectId>. Read-only token, no write scopes (contract §5).",
    baseUrl       = "https://<your-domain>.atlassian.net",
    email         = "<jira-account-email>",
    apiToken      = "<jira-api-token>",
    allowedKeys   = ["PROJ"],
    rotationNotes = "Rotation = overwrite this secret's value; PostgreSQL row unchanged (contract §3.4)."
  })
}

output "gemini_api_key_secret_id" {
  value = google_secret_manager_secret.gemini_api_key.secret_id
}

output "gemini_api_key_secret_name" {
  value = google_secret_manager_secret.gemini_api_key.id
}

# Project-level prefix runtime secrets follow, used by the iam module to scope
# the runtime service account's secret access.
output "jira_secret_prefix" {
  value = "${var.name_prefix}-jira-"
}
