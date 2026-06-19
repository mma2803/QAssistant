# 1.5 Cloud Run app service (api + dashboard, single service per D9) and the
# Artifact Registry repository that holds its images.

variable "project_id" {
  type = string
}

variable "region" {
  type = string
}

variable "name_prefix" {
  type = string
}

variable "image" {
  type = string
}

variable "service_account_email" {
  type = string
}

variable "min_instances" {
  type = number
}

variable "max_instances" {
  type = number
}

variable "cpu" {
  type = string
}

variable "memory" {
  type = string
}

variable "allow_unauthenticated" {
  type = bool
}

# Wiring into the rest of the stack (injected as env vars / volume mounts).
variable "cloudsql_connection_name" {
  type = string
}

variable "db_name" {
  type = string
}

variable "db_user" {
  type = string
}

variable "artifacts_bucket" {
  type = string
}

variable "gemini_api_key_secret_id" {
  type = string
}

variable "codegen_queue_name" {
  type = string
}

variable "labels" {
  type = map(string)
}

# --- Artifact Registry repository -----------------------------------------
resource "google_artifact_registry_repository" "app" {
  project       = var.project_id
  location      = var.region
  repository_id = "${var.name_prefix}-app"
  format        = "DOCKER"
  description   = "QAssistant app container images (api + dashboard)."
  labels        = var.labels
}

# --- Cloud Run service ----------------------------------------------------
resource "google_cloud_run_v2_service" "app" {
  project  = var.project_id
  name     = "${var.name_prefix}-app"
  location = var.region

  # Public ingress; the app authenticates each request via Identity Platform.
  ingress = "INGRESS_TRAFFIC_ALL"

  template {
    service_account = var.service_account_email

    scaling {
      min_instance_count = var.min_instances
      max_instance_count = var.max_instances
    }

    # Cloud SQL connection mounted via the built-in connection; the Node
    # connector (D23) also works, but declaring the instance here lets the app
    # use the unix socket fallback if desired.
    volumes {
      name = "cloudsql"
      cloud_sql_instance {
        instances = [var.cloudsql_connection_name]
      }
    }

    containers {
      image = var.image

      resources {
        limits = {
          cpu    = var.cpu
          memory = var.memory
        }
        cpu_idle = true
      }

      volume_mounts {
        name       = "cloudsql"
        mount_path = "/cloudsql"
      }

      env {
        name  = "GCP_PROJECT_ID"
        value = var.project_id
      }
      env {
        name  = "GCP_REGION"
        value = var.region
      }
      env {
        name  = "CLOUDSQL_CONNECTION_NAME"
        value = var.cloudsql_connection_name
      }
      env {
        name  = "DB_NAME"
        value = var.db_name
      }
      env {
        name  = "DB_USER"
        value = var.db_user
      }
      env {
        name  = "ARTIFACTS_BUCKET"
        value = var.artifacts_bucket
      }
      env {
        name  = "CODEGEN_QUEUE"
        value = var.codegen_queue_name
      }
      env {
        name  = "SERVICE_ACCOUNT_EMAIL"
        value = var.service_account_email
      }
      # Gemini key injected from Secret Manager at runtime (never inlined).
      env {
        name = "GEMINI_API_KEY"
        value_source {
          secret_key_ref {
            secret  = var.gemini_api_key_secret_id
            version = "latest"
          }
        }
      }
    }
  }

  labels = var.labels

  # The image var may be a placeholder on first apply; ignore drift on the
  # image so CI/CD can push real images without terraform fighting it.
  lifecycle {
    ignore_changes = [
      template[0].containers[0].image,
      client,
      client_version,
    ]
  }
}

# Public invocation toggle.
resource "google_cloud_run_v2_service_iam_member" "invoker_public" {
  count = var.allow_unauthenticated ? 1 : 0

  project  = var.project_id
  location = var.region
  name     = google_cloud_run_v2_service.app.name
  role     = "roles/run.invoker"
  member   = "allUsers"
}

# Cloud Tasks invokes the worker endpoint on the same service using the
# runtime SA's OIDC token, so the SA must be allowed to invoke the service.
resource "google_cloud_run_v2_service_iam_member" "invoker_runtime_sa" {
  project  = var.project_id
  location = var.region
  name     = google_cloud_run_v2_service.app.name
  role     = "roles/run.invoker"
  member   = "serviceAccount:${var.service_account_email}"
}

output "service_name" {
  value = google_cloud_run_v2_service.app.name
}

output "service_uri" {
  value = google_cloud_run_v2_service.app.uri
}

output "artifact_registry_repository" {
  value = google_artifact_registry_repository.app.repository_id
}

output "image_path_prefix" {
  description = "Push images here: <region>-docker.pkg.dev/<project>/<repo>/<image>"
  value       = "${var.region}-docker.pkg.dev/${var.project_id}/${google_artifact_registry_repository.app.repository_id}"
}
