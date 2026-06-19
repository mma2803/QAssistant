variable "project_id" {
  description = "GCP project ID that hosts the QAssistant stack."
  type        = string
}

variable "region" {
  description = "Primary GCP region for regional resources (Cloud Run, Cloud SQL, GCS, Artifact Registry, Cloud Tasks). EU region by default for GDPR posture."
  type        = string
  default     = "europe-west1"
}

variable "name_prefix" {
  description = "Prefix applied to resource names so multiple environments can share a project if needed."
  type        = string
  default     = "qassistant"
}

variable "labels" {
  description = "Common labels applied to all labelable resources."
  type        = map(string)
  default = {
    app        = "qassistant"
    managed_by = "terraform"
  }
}

# ---------------------------------------------------------------------------
# Cloud SQL
# ---------------------------------------------------------------------------
variable "db_tier" {
  description = "Cloud SQL machine tier. Smallest shared-core tier by default for MVP cost; size up for production."
  type        = string
  default     = "db-custom-1-3840"
}

variable "db_version" {
  description = "Cloud SQL PostgreSQL engine version."
  type        = string
  default     = "POSTGRES_16"
}

variable "db_name" {
  description = "Application database name created inside the Cloud SQL instance."
  type        = string
  default     = "qassistant"
}

variable "db_app_user" {
  description = "PostgreSQL login role used by Cloud Run at runtime (IAM-authenticated, RLS-bound)."
  type        = string
  default     = "qassistant_app"
}

variable "db_deletion_protection" {
  description = "Whether the Cloud SQL instance is protected from accidental terraform destroy."
  type        = bool
  default     = true
}

variable "db_availability_type" {
  description = "ZONAL (single zone, cheaper) or REGIONAL (HA). ZONAL for MVP."
  type        = string
  default     = "ZONAL"
  validation {
    condition     = contains(["ZONAL", "REGIONAL"], var.db_availability_type)
    error_message = "db_availability_type must be ZONAL or REGIONAL."
  }
}

# ---------------------------------------------------------------------------
# Cloud Run app service
# ---------------------------------------------------------------------------
variable "app_image" {
  description = "Fully-qualified container image for the app service (api + dashboard). Defaults to a public hello image placeholder so the first apply succeeds before CI pushes a real image; CI/CD overrides this."
  type        = string
  default     = "us-docker.pkg.dev/cloudrun/container/hello"
}

variable "app_min_instances" {
  description = "Minimum Cloud Run instances. 0 means scale to zero."
  type        = number
  default     = 0
}

variable "app_max_instances" {
  description = "Maximum Cloud Run instances. Caps DB connection fan-out; see pool-size note in design D22."
  type        = number
  default     = 4
}

variable "app_cpu" {
  description = "Cloud Run CPU per instance."
  type        = string
  default     = "1"
}

variable "app_memory" {
  description = "Cloud Run memory per instance."
  type        = string
  default     = "512Mi"
}

variable "app_allow_unauthenticated" {
  description = "Whether the app service is publicly invokable. The app authenticates requests itself via Identity Platform tokens, so public ingress with in-app auth is the MVP posture."
  type        = bool
  default     = true
}

# ---------------------------------------------------------------------------
# Identity Platform
# ---------------------------------------------------------------------------
variable "identity_authorized_domains" {
  description = "Authorized domains for Identity Platform (dashboard origins / redirect domains). localhost is included for local development."
  type        = list(string)
  default     = ["localhost"]
}

variable "identity_tenants" {
  description = "Optional list of GCIP tenant display names to pre-create. App tenants are normally created at runtime via the Admin SDK; this is for seeding/testing only."
  type        = list(string)
  default     = []
}

# ---------------------------------------------------------------------------
# Secret Manager
# ---------------------------------------------------------------------------
variable "gemini_api_key" {
  description = "Optional Gemini Developer API key to seed into Secret Manager. Leave empty to create the secret container without a version and add the value out of band (recommended)."
  type        = string
  default     = ""
  sensitive   = true
}

# ---------------------------------------------------------------------------
# Workload Identity Federation (GitHub Actions, D28)
# ---------------------------------------------------------------------------
variable "github_repository" {
  description = "GitHub repository in 'owner/repo' form allowed to deploy via Workload Identity Federation. Empty disables the GitHub WIF resources."
  type        = string
  default     = ""
}

variable "github_default_branch" {
  description = "Branch ref permitted to deploy (used in the WIF principal attribute condition)."
  type        = string
  default     = "main"
}

# ---------------------------------------------------------------------------
# Cloud Tasks (async codegen, D26)
# ---------------------------------------------------------------------------
variable "codegen_max_dispatches_per_second" {
  description = "Rate limit for the codegen Cloud Tasks queue."
  type        = number
  default     = 5
}

variable "codegen_max_concurrent_dispatches" {
  description = "Max concurrent in-flight codegen tasks."
  type        = number
  default     = 10
}
