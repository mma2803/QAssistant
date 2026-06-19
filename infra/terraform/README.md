# QAssistant Infrastructure (Terraform)

Terraform root module that provisions the QAssistant MVP stack on GCP managed
services in `europe-west1` (configurable). It implements the
platform-infrastructure spec: Cloud Run app service, Cloud SQL PostgreSQL, GCS
artifacts bucket, Secret Manager, Identity Platform (multi-tenant), Cloud Tasks,
Artifact Registry, a keyless runtime service account, and Workload Identity
Federation for GitHub Actions.

The database row-level-security policies, roles (`app_user`, `app_superadmin`
with `BYPASSRLS`, `app_migrator`), and grants are applied by the `apps/api`
Drizzle migrations, not by Terraform. Terraform provisions the Cloud SQL
instance, database, and the IAM database login for the runtime service account.

## Layout

```
infra/terraform/
  versions.tf            provider + terraform version constraints
  providers.tf           google / google-beta providers (use gcloud ADC)
  backend.tf             empty gcs backend (configured via backend.hcl)
  variables.tf           inputs (project_id, region, sizing, toggles)
  main.tf                wires the modules
  outputs.tf             stack outputs (URIs, bucket, SA, WIF provider, ...)
  terraform.tfvars.example
  backend.hcl.example
  modules/
    apis/                1.2 enable required service APIs
    storage/             1.3 GCS artifacts bucket (UBLA, versioned, no expiry)
    secrets/             1.4 Secret Manager (Gemini key + Jira structure doc)
    iam/                 1.4 runtime service account + keyless IAM bindings
    cloudsql/            1.7 Cloud SQL instance + db + IAM db user
    cloudtasks/          1.5 codegen queue
    cloudrun/            1.5 app service + Artifact Registry repo
    identity/            1.6 Identity Platform multi-tenant + email/password
    wif/                 1.4 Workload Identity Federation for GitHub Actions
```

## Operator prerequisites

These cannot be safely bootstrapped automatically and must be true before you
start:

1. A GCP project exists and **billing is enabled** on it.
2. You are authenticated with `gcloud` and have **Owner** or an equivalent set
   of admin roles on the project (project IAM admin, service usage admin,
   Cloud SQL admin, Cloud Run admin, Secret Manager admin, storage admin,
   Identity Platform admin, service account admin).
3. The Google Cloud SDK (`gcloud` + `gsutil`) and **Terraform >= 1.6** are
   installed locally.
4. **Identity Platform is enabled once in the Cloud Console** for the project
   (the first enablement of Identity Platform is a console action;
   subsequent config is managed here via `google_identity_platform_config`).
5. You have authenticated both surfaces gcloud uses:
   ```
   gcloud auth login
   gcloud auth application-default login
   gcloud config set project <PROJECT_ID>
   ```
6. Out-of-band values you will supply later: the **Gemini Developer API key**
   (added to Secret Manager), per-project **Jira API tokens** (created by the
   app at runtime), and any **custom dashboard domains** for Identity Platform
   authorized domains.

## Apply flow

From the repo root:

```bash
# 1. Bootstrap: verify auth, enable bootstrap APIs, create the state bucket,
#    and generate backend.hcl + a starter terraform.tfvars. Fails fast if
#    gcloud auth is invalid (no interactive retry loop). Idempotent.
PROJECT_ID=<PROJECT_ID> REGION=europe-west1 ./scripts/bootstrap-gcp.sh
```

Then from `infra/terraform/`:

```bash
terraform init -backend-config=backend.hcl
terraform plan -out plan.tfplan
terraform apply plan.tfplan
```

The first apply uses a public placeholder container image for the Cloud Run
service. CI/CD (GitHub Actions) builds and pushes the real image to Artifact
Registry and updates the service. Terraform ignores image drift on the Cloud
Run container, so apply and CI deploys do not fight each other.

### Add the Gemini key (recommended: out of band)

Leave `gemini_api_key = ""` in tfvars so the key never lands in Terraform
state, then:

```bash
echo -n "<gemini-developer-api-key>" \
  | gcloud secrets versions add qassistant-gemini-api-key --data-file=-
```

### Enable keyless CI/CD (Workload Identity Federation, D28)

Set in `terraform.tfvars`:

```hcl
github_repository     = "your-org/qassistant"
github_default_branch = "main"
```

After apply, read the outputs into your GitHub Actions workflow:

```bash
terraform output github_workload_identity_provider
terraform output github_deployer_service_account
```

and use them with `google-github-actions/auth` (no service-account key stored
in GitHub).

## Idempotency

- `bootstrap-gcp.sh` checks before every create, never overwrites an existing
  `backend.hcl` / `terraform.tfvars` (it writes a `*.new` file instead), and
  exits 0 on a re-run with no changes.
- `terraform apply` is naturally idempotent: re-running with no config changes
  reports no changes (`google_project_service` uses `disable_on_destroy =
  false` so service APIs are never toggled off underneath shared workloads).

## Retention note (D16)

The GCS artifacts bucket intentionally has **no lifecycle / auto-expiry rule**.
Artifacts (DOM-replay payloads and screenshots) are retained indefinitely until
explicit session deletion, which the backend purge job performs by deleting the
session object prefix. Do not add an age-based lifecycle rule without revisiting
design decision D16.

## Keyless posture (D9)

No service-account key files are created anywhere. Cloud Run runs as the runtime
service account and authenticates to GCS, Secret Manager, Cloud SQL (IAM auth
via the Node connector), and Cloud Tasks via workload identity. V4 signed URLs
are produced via IAM `signBlob` (the runtime SA has
`roles/iam.serviceAccountTokenCreator` on itself), so no signing key is stored.
GitHub Actions authenticates via Workload Identity Federation.
