import datetime
import os

import google.auth
from google.api_core.exceptions import NotFound
from google.auth import impersonated_credentials
from google.cloud import storage

GCS_BUCKET = os.environ["GCS_BUCKET"]
SIGNING_SERVICE_ACCOUNT = os.environ["GCS_SIGNING_SERVICE_ACCOUNT"]
SIGNED_URL_TTL_MINUTES = int(os.environ.get("SIGNED_URL_TTL_MINUTES", "15"))

_storage_client: storage.Client | None = None
_source_credentials = None


def _client() -> storage.Client:
    global _storage_client
    if _storage_client is None:
        _storage_client = storage.Client()
    return _storage_client


def _get_source_credentials():
    """ADC lookup only needs to happen once per Cloud Run instance (it's the same
    runtime service account for the instance's whole lifetime) — cached at module
    level instead of re-deriving it on every single /signed-url or /download-url call."""
    global _source_credentials
    if _source_credentials is None:
        _source_credentials, _ = google.auth.default()
    return _source_credentials


def _impersonated_credentials(scope: str) -> impersonated_credentials.Credentials:
    return impersonated_credentials.Credentials(
        source_credentials=_get_source_credentials(),
        target_principal=SIGNING_SERVICE_ACCOUNT,
        target_scopes=[scope],
        lifetime=SIGNED_URL_TTL_MINUTES * 60,
    )


def generate_signed_upload_url(object_path: str, content_type: str) -> str:
    """
    Mint a v4 signed URL for a direct browser PUT upload to GCS.

    Cloud Run's attached service account has no private key file to sign with
    locally, so signing is delegated to the IAM signBlob API via self-impersonation.
    This requires the runtime service account to hold roles/iam.serviceAccountTokenCreator
    on itself — see server/README.md.
    """
    signing_credentials = _impersonated_credentials("https://www.googleapis.com/auth/devstorage.read_write")
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
    signing_credentials = _impersonated_credentials("https://www.googleapis.com/auth/devstorage.read_only")
    blob = _client().bucket(GCS_BUCKET).blob(object_path)
    return blob.generate_signed_url(
        version="v4",
        expiration=datetime.timedelta(minutes=SIGNED_URL_TTL_MINUTES),
        method="GET",
        credentials=signing_credentials,
    )


def upload_bytes(object_path: str, data: bytes, content_type: str) -> None:
    """Server-side direct write to GCS (not a signed URL) — used to store the
    Cloud Run-generated report file (Phase 3b); the browser never uploads this
    one itself, so it doesn't need a signed PUT URL."""
    _client().bucket(GCS_BUCKET).blob(object_path).upload_from_string(data, content_type=content_type)


def delete_object(object_path: str) -> None:
    """Delete a GCS object. No-op if it's already gone, so callers can retry a
    partially-failed batch delete without erroring on the objects already removed."""
    try:
        _client().bucket(GCS_BUCKET).blob(object_path).delete()
    except NotFound:
        pass
