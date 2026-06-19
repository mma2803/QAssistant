#!/usr/bin/env bash
#
# bootstrap-gcp.sh - one-time, idempotent bootstrap for the QAssistant
# Terraform stack. It uses the ALREADY-authenticated gcloud CLI to:
#   1. verify gcloud auth (FAILS FAST, no interactive retry loop)
#   2. enable the bootstrap APIs Terraform itself needs at init time
#   3. create the remote Terraform state bucket (versioned, UBLA)
#   4. write backend.hcl and a starter terraform.tfvars in infra/terraform/
#
# After this, the operator runs (from infra/terraform/):
#   terraform init -backend-config=backend.hcl
#   terraform plan -out plan.tfplan
#   terraform apply plan.tfplan
#
# IDEMPOTENCY: every step checks before it creates. Re-running against an
# already-bootstrapped project makes no changes and exits 0. Existing
# backend.hcl / terraform.tfvars are NOT overwritten (a *.new file is written
# instead so operator edits are never clobbered).
#
# This script never deploys application infrastructure and never runs
# terraform; it only prepares prerequisites.

set -euo pipefail

# --- Resolve paths --------------------------------------------------------
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
TF_DIR="${REPO_ROOT}/infra/terraform"

# --- Config (env-overridable) ---------------------------------------------
PROJECT_ID="${PROJECT_ID:-${1:-}}"
REGION="${REGION:-europe-west1}"
NAME_PREFIX="${NAME_PREFIX:-qassistant}"
STATE_PREFIX="${STATE_PREFIX:-qassistant/mvp}"

# --- Helpers --------------------------------------------------------------
log()  { printf '\033[1;34m[bootstrap]\033[0m %s\n' "$*"; }
ok()   { printf '\033[1;32m[ ok ]\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33m[warn]\033[0m %s\n' "$*"; }
die()  { printf '\033[1;31m[fail]\033[0m %s\n' "$*" >&2; exit 1; }

# --- Preconditions --------------------------------------------------------
command -v gcloud >/dev/null 2>&1 || die "gcloud CLI not found on PATH. Install the Google Cloud SDK first."
command -v gsutil >/dev/null 2>&1 || die "gsutil not found on PATH (ships with the Google Cloud SDK)."

if [[ -z "${PROJECT_ID}" ]]; then
  PROJECT_ID="$(gcloud config get-value project 2>/dev/null || true)"
fi
[[ -n "${PROJECT_ID}" && "${PROJECT_ID}" != "(unset)" ]] || \
  die "No project id. Pass it as the first arg, set PROJECT_ID, or run: gcloud config set project <id>"

# --- FAIL FAST on invalid auth (no interactive retry loop) ----------------
log "Verifying gcloud authentication (no interactive login will be attempted)..."
ACTIVE_ACCOUNT="$(gcloud auth list --filter=status:ACTIVE --format='value(account)' 2>/dev/null || true)"
[[ -n "${ACTIVE_ACCOUNT}" ]] || \
  die "No ACTIVE gcloud account. Run 'gcloud auth login' and 'gcloud auth application-default login' yourself, then re-run. Aborting (no retry loop)."

# Confirm Application Default Credentials exist; Terraform uses ADC.
if ! gcloud auth application-default print-access-token >/dev/null 2>&1; then
  die "Application Default Credentials are not valid. Run 'gcloud auth application-default login'. Aborting (no retry loop)."
fi

# Confirm the active credentials can actually see the project (catches wrong
# account / missing permission early instead of mid-terraform).
gcloud projects describe "${PROJECT_ID}" >/dev/null 2>&1 || \
  die "Active account '${ACTIVE_ACCOUNT}' cannot access project '${PROJECT_ID}' (wrong account or missing IAM). Aborting (no retry loop)."

ok "Authenticated as '${ACTIVE_ACCOUNT}' with access to project '${PROJECT_ID}'."

# --- Enable bootstrap APIs (idempotent) -----------------------------------
# Only the minimum needed for terraform init + state. Terraform enables the
# full set declaratively (modules/apis), but enabling these here lets the very
# first plan/apply run without a chicken-and-egg failure.
BOOTSTRAP_APIS=(
  "storage.googleapis.com"
  "serviceusage.googleapis.com"
  "cloudresourcemanager.googleapis.com"
  "iam.googleapis.com"
)
log "Ensuring bootstrap APIs are enabled..."
ENABLED="$(gcloud services list --enabled --project "${PROJECT_ID}" --format='value(config.name)' 2>/dev/null || true)"
TO_ENABLE=()
for api in "${BOOTSTRAP_APIS[@]}"; do
  if grep -qx "${api}" <<<"${ENABLED}"; then
    ok "API already enabled: ${api}"
  else
    TO_ENABLE+=("${api}")
  fi
done
if [[ ${#TO_ENABLE[@]} -gt 0 ]]; then
  log "Enabling: ${TO_ENABLE[*]}"
  gcloud services enable "${TO_ENABLE[@]}" --project "${PROJECT_ID}"
  ok "Bootstrap APIs enabled."
else
  ok "All bootstrap APIs already enabled."
fi

# --- Create the Terraform state bucket (idempotent) -----------------------
STATE_BUCKET="${NAME_PREFIX}-tfstate-${PROJECT_ID}"
log "Ensuring Terraform state bucket gs://${STATE_BUCKET} exists..."
if gsutil ls -b "gs://${STATE_BUCKET}" >/dev/null 2>&1; then
  ok "State bucket already exists: gs://${STATE_BUCKET}"
else
  gsutil mb -p "${PROJECT_ID}" -l "${REGION}" -b on "gs://${STATE_BUCKET}"
  ok "Created state bucket: gs://${STATE_BUCKET}"
fi
# Versioning on the state bucket protects against state corruption. Setting it
# repeatedly is harmless (idempotent).
gsutil versioning set on "gs://${STATE_BUCKET}" >/dev/null
gsutil pap set enforced "gs://${STATE_BUCKET}" >/dev/null 2>&1 || \
  warn "Could not enforce public-access-prevention on state bucket (older gsutil?); set it manually."
ok "State bucket versioning enabled and public access prevented."

# --- Write backend.hcl (do not clobber) -----------------------------------
BACKEND_FILE="${TF_DIR}/backend.hcl"
write_backend() {
  cat >"$1" <<EOF
bucket = "${STATE_BUCKET}"
prefix = "${STATE_PREFIX}"
EOF
}
if [[ -f "${BACKEND_FILE}" ]]; then
  write_backend "${BACKEND_FILE}.new"
  warn "backend.hcl exists; wrote backend.hcl.new instead. Review and replace if needed."
else
  write_backend "${BACKEND_FILE}"
  ok "Wrote ${BACKEND_FILE}"
fi

# --- Write starter terraform.tfvars (do not clobber) ----------------------
TFVARS_FILE="${TF_DIR}/terraform.tfvars"
write_tfvars() {
  cat >"$1" <<EOF
project_id  = "${PROJECT_ID}"
region      = "${REGION}"
name_prefix = "${NAME_PREFIX}"

# See terraform.tfvars.example for all options.
# Add the Gemini key out of band after apply:
#   echo -n "<key>" | gcloud secrets versions add ${NAME_PREFIX}-gemini-api-key --data-file=-
gemini_api_key = ""

# Enable keyless CI/CD by setting your repo (owner/repo):
github_repository     = ""
github_default_branch = "main"
EOF
}
if [[ -f "${TFVARS_FILE}" ]]; then
  write_tfvars "${TFVARS_FILE}.new"
  warn "terraform.tfvars exists; wrote terraform.tfvars.new instead. Review and replace if needed."
else
  write_tfvars "${TFVARS_FILE}"
  ok "Wrote ${TFVARS_FILE}"
fi

# --- Done -----------------------------------------------------------------
cat <<EOF

$(ok "Bootstrap complete.")

Next steps (from ${TF_DIR}):
  terraform init -backend-config=backend.hcl
  terraform plan -out plan.tfplan
  terraform apply plan.tfplan

State bucket : gs://${STATE_BUCKET} (prefix: ${STATE_PREFIX})
Project      : ${PROJECT_ID}
Region       : ${REGION}
EOF
