# 1.4 Workload Identity Federation for GitHub Actions (D28).
#
# GitHub OIDC -> GCP, so CI/CD deploys with NO service-account key stored in
# GitHub. A dedicated deployer SA is impersonated by the GitHub workflow via the
# WIF provider, restricted to a single repository (and optionally branch).

variable "project_id" {
  type = string
}

variable "name_prefix" {
  type = string
}

# "owner/repo"
variable "github_repository" {
  type = string
}

variable "default_branch" {
  type = string
}

variable "artifact_registry_repository_id" {
  type        = string
  description = "Repo id so the deployer can push images."
}

variable "region" {
  type = string
}

# --- Deployer service account (impersonated by GitHub Actions) ------------
resource "google_service_account" "deployer" {
  project      = var.project_id
  account_id   = "${var.name_prefix}-gh-deployer"
  display_name = "QAssistant GitHub Actions deployer (WIF, keyless)"
}

# Roles the deployer needs to build/push images, deploy Cloud Run, and run
# terraform plan/apply from CI.
resource "google_project_iam_member" "deployer_roles" {
  for_each = toset([
    "roles/run.admin",
    "roles/artifactregistry.writer",
    "roles/cloudsql.admin",
    "roles/secretmanager.admin",
    "roles/storage.admin",
    "roles/iam.serviceAccountAdmin",
    "roles/iam.serviceAccountUser",
    "roles/cloudtasks.admin",
    "roles/serviceusage.serviceUsageAdmin",
    "roles/resourcemanager.projectIamAdmin",
    "roles/identityplatform.admin",
  ])

  project = var.project_id
  role    = each.value
  member  = "serviceAccount:${google_service_account.deployer.email}"
}

# --- Workload Identity Pool + GitHub OIDC provider ------------------------
resource "google_iam_workload_identity_pool" "github" {
  project                   = var.project_id
  workload_identity_pool_id = "${var.name_prefix}-gh-pool"
  display_name              = "QAssistant GitHub Actions"
  description               = "WIF pool trusting GitHub Actions OIDC for ${var.github_repository}."
}

resource "google_iam_workload_identity_pool_provider" "github" {
  project                            = var.project_id
  workload_identity_pool_id          = google_iam_workload_identity_pool.github.workload_identity_pool_id
  workload_identity_pool_provider_id = "${var.name_prefix}-gh-oidc"
  display_name                       = "GitHub OIDC"

  attribute_mapping = {
    "google.subject"       = "assertion.sub"
    "attribute.repository" = "assertion.repository"
    "attribute.ref"        = "assertion.ref"
  }

  # Hard restrict the provider to the configured repository: tokens from any
  # other repo are rejected at the provider level.
  attribute_condition = "assertion.repository == '${var.github_repository}'"

  oidc {
    issuer_uri = "https://token.actions.githubusercontent.com"
  }
}

# Allow only the configured repository on the configured branch to impersonate
# the deployer SA.
resource "google_service_account_iam_member" "deployer_wif_binding" {
  service_account_id = google_service_account.deployer.name
  role               = "roles/iam.workloadIdentityUser"
  member             = "principalSet://iam.googleapis.com/${google_iam_workload_identity_pool.github.name}/attribute.repository/${var.github_repository}"
}

output "workload_identity_provider" {
  description = "Value for the GitHub Actions google-github-actions/auth workload_identity_provider input."
  value       = google_iam_workload_identity_pool_provider.github.name
}

output "deployer_service_account_email" {
  value = google_service_account.deployer.email
}
