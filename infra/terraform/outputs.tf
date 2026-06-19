output "project_id" {
  value = var.project_id
}

output "region" {
  value = var.region
}

# --- Storage --------------------------------------------------------------
output "artifacts_bucket" {
  description = "GCS bucket for DOM-replay payloads and screenshots."
  value       = module.storage.bucket_name
}

# --- Secrets --------------------------------------------------------------
output "gemini_api_key_secret_id" {
  value = module.secrets.gemini_api_key_secret_id
}

# --- Cloud SQL ------------------------------------------------------------
output "cloudsql_connection_name" {
  description = "project:region:instance for the Node connector."
  value       = module.cloudsql.connection_name
}

output "cloudsql_database" {
  value = module.cloudsql.database_name
}

output "cloudsql_runtime_user" {
  value = module.cloudsql.runtime_db_user
}

# --- Cloud Run / Artifact Registry ---------------------------------------
output "app_service_uri" {
  value = module.cloudrun.service_uri
}

output "app_image_path_prefix" {
  description = "Push images to <prefix>/<image>:<tag>."
  value       = module.cloudrun.image_path_prefix
}

output "runtime_service_account_email" {
  value = module.iam.runtime_service_account_email
}

# --- Cloud Tasks ----------------------------------------------------------
output "codegen_queue" {
  value = module.cloudtasks.queue_name
}

# --- Identity Platform ----------------------------------------------------
output "identity_multi_tenancy_enabled" {
  value = module.identity.multi_tenancy_enabled
}

# --- Workload Identity Federation (GitHub Actions) ------------------------
output "github_workload_identity_provider" {
  description = "Set as the workload_identity_provider input in GitHub Actions auth. Empty when github_repository is unset."
  value       = length(module.wif) > 0 ? module.wif[0].workload_identity_provider : ""
}

output "github_deployer_service_account" {
  description = "service_account input for GitHub Actions auth. Empty when github_repository is unset."
  value       = length(module.wif) > 0 ? module.wif[0].deployer_service_account_email : ""
}
