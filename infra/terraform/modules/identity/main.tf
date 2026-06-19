# 1.6 Identity Platform (identity toolkit) config with multi-tenancy enabled
# and the email/password provider (D1, D2).
#
# google_identity_platform_config is a singleton per project. Multi-tenancy is
# enabled so each app tenant maps to one GCIP tenant (created at runtime via the
# Admin SDK). The super-admin is a project-level user with no tenant.

variable "project_id" {
  type = string
}

variable "authorized_domains" {
  type = list(string)
}

# Optional GCIP tenants to pre-create (seeding/testing only).
variable "tenants" {
  type    = list(string)
  default = []
}

resource "google_identity_platform_config" "default" {
  project = var.project_id

  # Enable native multi-tenancy.
  multi_tenant {
    allow_tenants = true
  }

  authorized_domains = var.authorized_domains

  # Project-level (default, tenant-less) sign-in config: email/password on,
  # no email-link / passwordless (no email sender in MVP, D2).
  sign_in {
    allow_duplicate_emails = false

    email {
      enabled           = true
      password_required = true
    }
  }
}

# Pre-created GCIP tenants (optional). Each has email/password enabled. App
# tenants are normally created at runtime by the backend Admin SDK; this is for
# seeding only.
resource "google_identity_platform_tenant" "seed" {
  for_each = toset(var.tenants)

  project                  = var.project_id
  display_name             = each.value
  allow_password_signup    = true
  enable_email_link_signin = false

  depends_on = [google_identity_platform_config.default]
}

output "multi_tenancy_enabled" {
  value = google_identity_platform_config.default.multi_tenant[0].allow_tenants
}

output "seeded_tenant_ids" {
  value = { for k, t in google_identity_platform_tenant.seed : k => t.name }
}
