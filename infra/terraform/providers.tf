# Provider configuration. Credentials come from the already-authenticated
# gcloud CLI (Application Default Credentials); no key file is referenced.
provider "google" {
  project = var.project_id
  region  = var.region
}

provider "google-beta" {
  project = var.project_id
  region  = var.region
}
