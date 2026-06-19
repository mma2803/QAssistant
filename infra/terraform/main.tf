# QAssistant MVP root module. Wires the per-capability modules together.
# Apply order is handled by Terraform's dependency graph; the apis module is a
# dependency of everything that needs a freshly enabled service.

# 1.2 Enable required APIs first.
module "apis" {
  source     = "./modules/apis"
  project_id = var.project_id
}

# 1.3 GCS artifacts bucket.
module "storage" {
  source      = "./modules/storage"
  project_id  = var.project_id
  region      = var.region
  name_prefix = var.name_prefix
  labels      = var.labels

  depends_on = [module.apis]
}

# 1.4 Secret Manager secrets.
module "secrets" {
  source         = "./modules/secrets"
  project_id     = var.project_id
  region         = var.region
  name_prefix    = var.name_prefix
  labels         = var.labels
  gemini_api_key = var.gemini_api_key

  depends_on = [module.apis]
}

# 1.4 Runtime service account + IAM (keyless).
module "iam" {
  source                   = "./modules/iam"
  project_id               = var.project_id
  name_prefix              = var.name_prefix
  artifacts_bucket         = module.storage.bucket_name
  gemini_api_key_secret_id = module.secrets.gemini_api_key_secret_id
  runtime_secret_prefix    = module.secrets.jira_secret_prefix

  depends_on = [module.apis]
}

# 1.7 (provisioning) Cloud SQL PostgreSQL. RLS/roles done in apps/api migrations.
module "cloudsql" {
  source                        = "./modules/cloudsql"
  project_id                    = var.project_id
  region                        = var.region
  name_prefix                   = var.name_prefix
  tier                          = var.db_tier
  db_version                    = var.db_version
  db_name                       = var.db_name
  availability_type             = var.db_availability_type
  deletion_protection           = var.db_deletion_protection
  runtime_service_account_email = module.iam.runtime_service_account_email
  labels                        = var.labels

  depends_on = [module.apis]
}

# 1.5 Cloud Tasks queue (async codegen).
module "cloudtasks" {
  source                    = "./modules/cloudtasks"
  project_id                = var.project_id
  region                    = var.region
  name_prefix               = var.name_prefix
  max_dispatches_per_second = var.codegen_max_dispatches_per_second
  max_concurrent_dispatches = var.codegen_max_concurrent_dispatches

  depends_on = [module.apis]
}

# 1.5 Cloud Run app service + Artifact Registry.
module "cloudrun" {
  source                   = "./modules/cloudrun"
  project_id               = var.project_id
  region                   = var.region
  name_prefix              = var.name_prefix
  image                    = var.app_image
  service_account_email    = module.iam.runtime_service_account_email
  min_instances            = var.app_min_instances
  max_instances            = var.app_max_instances
  cpu                      = var.app_cpu
  memory                   = var.app_memory
  allow_unauthenticated    = var.app_allow_unauthenticated
  cloudsql_connection_name = module.cloudsql.connection_name
  db_name                  = module.cloudsql.database_name
  db_user                  = module.cloudsql.runtime_db_user
  artifacts_bucket         = module.storage.bucket_name
  gemini_api_key_secret_id = module.secrets.gemini_api_key_secret_id
  codegen_queue_name       = module.cloudtasks.queue_name
  labels                   = var.labels

  depends_on = [module.apis, module.iam]
}

# 1.6 Identity Platform multi-tenant + email/password.
module "identity" {
  source             = "./modules/identity"
  project_id         = var.project_id
  authorized_domains = var.identity_authorized_domains
  tenants            = var.identity_tenants

  depends_on = [module.apis]
}

# 1.4 Workload Identity Federation for GitHub Actions (optional).
module "wif" {
  count  = var.github_repository == "" ? 0 : 1
  source = "./modules/wif"

  project_id                      = var.project_id
  name_prefix                     = var.name_prefix
  region                          = var.region
  github_repository               = var.github_repository
  default_branch                  = var.github_default_branch
  artifact_registry_repository_id = module.cloudrun.artifact_registry_repository

  depends_on = [module.apis]
}
