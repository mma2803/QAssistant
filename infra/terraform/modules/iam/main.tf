# 1.4 Service account for Cloud Run + IAM, keyless (workload identity).
#
# No service-account key files are ever created (D9). Cloud Run runs AS this
# service account; the app authenticates to GCS, Secret Manager, Cloud SQL,
# and Cloud Tasks via the attached identity. The same SA signs V4 URLs using
# the IAM signBlob path (roles/iam.serviceAccountTokenCreator on itself), so no
# private key is needed for signing either (D27).

variable "project_id" {
  type = string
}

variable "name_prefix" {
  type = string
}

variable "artifacts_bucket" {
  type = string
}

variable "gemini_api_key_secret_id" {
  type = string
}

# Prefix that per-project runtime secrets (Jira tokens, default creds) share.
variable "runtime_secret_prefix" {
  type = string
}

# ---------------------------------------------------------------------------
# Runtime service account used by the Cloud Run app service.
# ---------------------------------------------------------------------------
resource "google_service_account" "runtime" {
  project      = var.project_id
  account_id   = "${var.name_prefix}-run"
  display_name = "QAssistant Cloud Run runtime (keyless / workload identity)"
}

# Allow the runtime SA to mint self-signed blobs for V4 signed URLs without a
# key file (signBlob).
resource "google_service_account_iam_member" "runtime_token_creator_self" {
  service_account_id = google_service_account.runtime.name
  role               = "roles/iam.serviceAccountTokenCreator"
  member             = "serviceAccount:${google_service_account.runtime.email}"
}

# --- GCS: read/write artifacts bucket only --------------------------------
resource "google_storage_bucket_iam_member" "runtime_artifacts_admin" {
  bucket = var.artifacts_bucket
  role   = "roles/storage.objectAdmin"
  member = "serviceAccount:${google_service_account.runtime.email}"
}

# --- Cloud SQL: connect via the Node connector / IAM auth -----------------
resource "google_project_iam_member" "runtime_cloudsql_client" {
  project = var.project_id
  role    = "roles/cloudsql.client"
  member  = "serviceAccount:${google_service_account.runtime.email}"
}

resource "google_project_iam_member" "runtime_cloudsql_instance_user" {
  project = var.project_id
  role    = "roles/cloudsql.instanceUser"
  member  = "serviceAccount:${google_service_account.runtime.email}"
}

# --- Secret Manager: access the Gemini key + per-project runtime secrets ---
# Bound at the specific Gemini secret for least privilege.
resource "google_secret_manager_secret_iam_member" "runtime_gemini_accessor" {
  project   = var.project_id
  secret_id = var.gemini_api_key_secret_id
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${google_service_account.runtime.email}"
}

# The backend creates and reads per-project Jira/default-creds secrets at
# runtime. Project-level secret admin is required to create them; scoping to a
# name prefix is not supported by IAM conditions on secret_id, so this is a
# documented broad grant. Tighten via an org policy / dedicated secret folder
# project if least privilege at the per-secret level becomes a requirement.
resource "google_project_iam_member" "runtime_secret_admin" {
  project = var.project_id
  role    = "roles/secretmanager.admin"
  member  = "serviceAccount:${google_service_account.runtime.email}"
}

# --- Cloud Tasks: enqueue codegen tasks -----------------------------------
resource "google_project_iam_member" "runtime_cloudtasks_enqueuer" {
  project = var.project_id
  role    = "roles/cloudtasks.enqueuer"
  member  = "serviceAccount:${google_service_account.runtime.email}"
}

# The SA also acts as the OIDC identity Cloud Tasks uses to call the worker
# endpoint, so it must be able to act as itself when creating tasks with an
# OIDC token.
resource "google_service_account_iam_member" "runtime_act_as_self" {
  service_account_id = google_service_account.runtime.name
  role               = "roles/iam.serviceAccountUser"
  member             = "serviceAccount:${google_service_account.runtime.email}"
}

output "runtime_service_account_email" {
  value = google_service_account.runtime.email
}

output "runtime_service_account_id" {
  value = google_service_account.runtime.id
}

output "runtime_service_account_name" {
  value = google_service_account.runtime.name
}
