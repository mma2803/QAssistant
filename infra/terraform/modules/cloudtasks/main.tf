# 1.5 Cloud Tasks queue for async codegen (D26).
# POST /sessions/{id}/generate enqueues here; Cloud Tasks calls the worker
# endpoint POST /internal/tasks/generate with an OIDC token.

variable "project_id" {
  type = string
}

variable "region" {
  type = string
}

variable "name_prefix" {
  type = string
}

variable "max_dispatches_per_second" {
  type = number
}

variable "max_concurrent_dispatches" {
  type = number
}

resource "google_cloud_tasks_queue" "codegen" {
  project  = var.project_id
  name     = "${var.name_prefix}-codegen"
  location = var.region

  rate_limits {
    max_dispatches_per_second = var.max_dispatches_per_second
    max_concurrent_dispatches = var.max_concurrent_dispatches
  }

  retry_config {
    max_attempts       = 5
    min_backoff        = "5s"
    max_backoff        = "300s"
    max_doublings      = 4
    max_retry_duration = "3600s"
  }
}

output "queue_name" {
  value = google_cloud_tasks_queue.codegen.name
}

output "queue_id" {
  value = google_cloud_tasks_queue.codegen.id
}
