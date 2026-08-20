import datetime
import os

import google.auth
from google.auth import impersonated_credentials
from google.cloud import storage

GCS_BUCKET = os.environ["GCS_BUCKET"]
SIGNING_SERVICE_ACCOUNT = os.environ["GCS_SIGNING_SERVICE_ACCOUNT"]
SIGNED_URL_TTL_MINUTES = int(os.environ.get("SIGNED_URL_TTL_MINUTES", "15"))

_storage_client: storage.Client | None = None


def _client() -> storage.Client:
    global _storage_client
    if _storage_client is None:
        _storage_client = storage.Client()
    return _storage_client


def generate_signed_upload_url(object_path: str, content_type: str) -> str:
    """
    Mint a v4 signed URL for a direct browser PUT upload to GCS.

    Cloud Run's attached service account has no private key file to sign with
    locally, so signing is delegated to the IAM signBlob API via self-impersonation.
    This requires the runtime service account to hold roles/iam.serviceAccountTokenCreator
    on itself — see server/README.md.
    """
    source_credentials, _ = google.auth.default()
    signing_credentials = impersonated_credentials.Credentials(
        source_credentials=source_credentials,
        target_principal=SIGNING_SERVICE_ACCOUNT,
        target_scopes=["https://www.googleapis.com/auth/devstorage.read_write"],
        lifetime=SIGNED_URL_TTL_MINUTES * 60,
    )
    blob = _client().bucket(GCS_BUCKET).blob(object_path)
    return blob.generate_signed_url(
        version="v4",
        expiration=datetime.timedelta(minutes=SIGNED_URL_TTL_MINUTES),
        method="PUT",
        content_type=content_type,
        credentials=signing_credentials,
    )


def generate_signed_download_url(object_path: str) -> str:
    """Mint a v4 signed URL for a direct browser GET download from GCS. See
    generate_signed_upload_url() for why signing is delegated via self-impersonation."""
    source_credentials, _ = google.auth.default()
    signing_credentials = impersonated_credentials.Credentials(
        source_credentials=source_credentials,
        target_principal=SIGNING_SERVICE_ACCOUNT,
        target_scopes=["https://www.googleapis.com/auth/devstorage.read_only"],
        lifetime=SIGNED_URL_TTL_MINUTES * 60,
    )
    blob = _client().bucket(GCS_BUCKET).blob(object_path)
    return blob.generate_signed_url(
        version="v4",
        expiration=datetime.timedelta(minutes=SIGNED_URL_TTL_MINUTES),
        method="GET",
        credentials=signing_credentials,
    )
