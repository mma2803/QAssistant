# 1.7 (provisioning side) Cloud SQL PostgreSQL.
#
# RLS policies, database roles (app_user / app_superadmin BYPASSRLS /
# app_migrator), and table grants are created by the apps/api Drizzle
# migrations (contract §8), NOT here. This module only provisions the instance,
# the application database, and the IAM-authenticated runtime login so the
# Node connector can connect keylessly (D23).

variable "project_id" {
  type = string
}

variable "region" {
  type = string
}

variable "name_prefix" {
  type = string
}

variable "tier" {
  type = string
}

variable "db_version" {
  type = string
}

variable "db_name" {
  type = string
}

variable "availability_type" {
  type = string
}

variable "deletion_protection" {
  type = bool
}

variable "runtime_service_account_email" {
  description = "Cloud Run runtime SA, registered as an IAM database user for keyless login."
  type        = string
}

variable "labels" {
  type = map(string)
}

resource "google_sql_database_instance" "main" {
  project          = var.project_id
  name             = "${var.name_prefix}-pg"
  region           = var.region
  database_version = var.db_version

  deletion_protection = var.deletion_protection

  settings {
    tier              = var.tier
    availability_type = var.availability_type
    disk_autoresize   = true
    disk_type         = "PD_SSD"

    # Cloud SQL IAM database authentication so the Cloud Run SA logs in without
    # a stored password (keyless, D23). The Node connector handles TLS.
    database_flags {
      name  = "cloudsql.iam_authentication"
      value = "on"
    }

    backup_configuration {
      enabled                        = true
      point_in_time_recovery_enabled = true
      start_time                     = "03:00"
      transaction_log_retention_days = 7
    }

    ip_configuration {
      # Public IP reachable only through the Cloud SQL connector with TLS +
      # IAM; no authorized networks are added, so there is no open IP path.
      ipv4_enabled = true
    }

    insights_config {
      query_insights_enabled = true
    }

    user_labels = var.labels
  }
}

# Application database.
resource "google_sql_database" "app" {
  project  = var.project_id
  instance = google_sql_database_instance.main.name
  name     = var.db_name
}

# IAM database user mapped to the Cloud Run runtime service account. The login
# name for a service-account IAM user is the SA email WITHOUT the
# ".gserviceaccount.com" suffix.
resource "google_sql_user" "runtime_iam" {
  project  = var.project_id
  instance = google_sql_database_instance.main.name
  name     = trimsuffix(var.runtime_service_account_email, ".gserviceaccount.com")
  type     = "CLOUD_IAM_SERVICE_ACCOUNT"
}

output "instance_name" {
  value = google_sql_database_instance.main.name
}

output "connection_name" {
  description = "INSTANCE connection name (project:region:instance) for the Node connector."
  value       = google_sql_database_instance.main.connection_name
}

output "database_name" {
  value = google_sql_database.app.name
}

output "runtime_db_user" {
  value = google_sql_user.runtime_iam.name
}
