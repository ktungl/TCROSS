"""pytest 共用設定：import 路徑、假環境變數、斷網防護。

所有 Parse／GCS／Gemini 呼叫一律 mock，絕不連線真服務。這裡的 autouse fixture 會把
三者的底層 client 換成「一被呼叫就讓測試失敗」的替身，萬一哪個測試漏 mock 也不會真的連線。"""

import os
import sys

import pytest

SERVER_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if SERVER_DIR not in sys.path:
    sys.path.insert(0, SERVER_DIR)

# 必須在 import main / parse_auth / storage / report 之前設好，這些模組在 import 時就讀環境變數。
# 一律用假值覆蓋（不用 setdefault），避免開發者本機 shell 裡的真設定被帶進測試。
_FAKE_ENV = {
    "PARSE_SERVER_URL": "https://parse.invalid",
    "PARSE_APP_ID": "test-app-id",
    "PARSE_JS_KEY": "test-js-key",
    "PARSE_MASTER_KEY": "test-master-key",
    "GCS_BUCKET": "test-bucket",
    "GCS_SIGNING_SERVICE_ACCOUNT": "signer@test.invalid",
    "ALLOWED_ORIGIN": "http://localhost:5173",
    "GCP_PROJECT": "test-project",
    "GCP_LOCATION": "asia-northeast1",
    "GEMINI_MODEL": "gemini-test",
    "MAX_SOURCE_FILES": "20",
    "MPLBACKEND": "Agg",
}
os.environ.update(_FAKE_ENV)


class _NoNetwork:
    """任何屬性存取都直接讓測試失敗：代表有呼叫沒被 mock 到。"""

    def __init__(self, name: str):
        self._name = name

    def __getattr__(self, attr):
        raise AssertionError(f"測試不該呼叫真正的 {self._name}.{attr}（漏了 mock）")

    def __call__(self, *args, **kwargs):
        raise AssertionError(f"測試不該呼叫真正的 {self._name}（漏了 mock）")


@pytest.fixture(autouse=True)
def _block_real_services(monkeypatch):
    import parse_auth
    import report
    import storage

    monkeypatch.setattr(parse_auth, "_client", _NoNetwork("Parse httpx client"))
    monkeypatch.setattr(storage, "_client", _NoNetwork("GCS storage client"))
    monkeypatch.setattr(report, "_get_client", _NoNetwork("Gemini client"))
    parse_auth._session_cache.clear()
    yield


@pytest.fixture(autouse=True)
def _reset_rate_limit():
    import main

    main._rate_limit_hits.clear()
    yield
    main._rate_limit_hits.clear()


VALID_TOKEN = "r:valid-session-token"
TEST_USER = {"objectId": "user1", "username": "tester"}


@pytest.fixture
def client(monkeypatch):
    """TestClient，session 驗證已 mock：只有 VALID_TOKEN 視為有效。"""
    from fastapi.testclient import TestClient

    import main

    def fake_verify(token):
        return dict(TEST_USER) if token == VALID_TOKEN else None

    monkeypatch.setattr(main, "verify_session_token", fake_verify)
    return TestClient(main.app)


@pytest.fixture
def auth():
    return {"Authorization": f"Bearer {VALID_TOKEN}"}
