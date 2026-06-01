from __future__ import annotations

import json
import os
import subprocess
import sys
import tempfile
import time
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen


ROOT = Path(__file__).resolve().parents[1]
PORT = "7894"
ADMIN_KEY = "release-check-admin-key"


def request_json(path: str, headers: dict[str, str] | None = None) -> tuple[int, dict]:
    request = Request(f"http://127.0.0.1:{PORT}{path}", headers=headers or {})
    try:
        with urlopen(request, timeout=5) as response:
            return response.status, json.loads(response.read().decode("utf-8"))
    except HTTPError as exc:
        return exc.code, json.loads(exc.read().decode("utf-8"))


def wait_for_server(proc: subprocess.Popen, timeout_seconds: int = 10) -> None:
    deadline = time.time() + timeout_seconds
    last_error: Exception | None = None
    while time.time() < deadline:
        if proc.poll() is not None:
            raise RuntimeError(f"server exited early with code {proc.returncode}")
        try:
            status, body = request_json("/health")
            if status == 200 and body.get("ok") is True:
                return
        except (OSError, URLError) as exc:
            last_error = exc
        time.sleep(0.2)
    raise RuntimeError(f"server did not become healthy: {last_error}")


def assert_true(condition: bool, message: str) -> None:
    if not condition:
        raise AssertionError(message)


def run() -> int:
    subprocess.run([sys.executable, "-m", "py_compile", str(ROOT / "backend" / "server.py")], check=True)

    with tempfile.TemporaryDirectory(prefix="33party-release-") as tmp_dir:
        env = os.environ.copy()
        env.update(
            {
                "PARTY_DB_PATH": str(Path(tmp_dir) / "party.db"),
                "APP_ENV": "production",
                "ADMIN_API_KEY": ADMIN_KEY,
                "PORT": PORT,
            }
        )
        proc = subprocess.Popen(
            [sys.executable, str(ROOT / "backend" / "server.py")],
            cwd=str(ROOT),
            env=env,
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            text=True,
        )
        try:
            wait_for_server(proc)

            status, body = request_json("/api/room?partyId=party_demo&tableId=table_a01&userId=user_demo_1")
            assert_true(status == 200 and body.get("ok") is True, "room API should return ok")
            messages = body["room"]["messages"]
            user_message = next(message for message in messages if message["senderType"] == "user")
            assert_true(user_message["sender"].get("memberId"), "user message sender should include memberId")

            status, body = request_json("/api/admin/tables?partyId=party_demo&adminId=admin_mimei")
            assert_true(status == 401 and body.get("ok") is False, "admin API should reject missing key")

            status, body = request_json(
                "/api/admin/tables?partyId=party_demo&adminId=admin_mimei",
                headers={"X-Admin-Key": ADMIN_KEY},
            )
            assert_true(status == 200 and body.get("ok") is True, "admin API should accept valid key")

            print("release check passed")
            return 0
        finally:
            proc.terminate()
            try:
                proc.wait(timeout=5)
            except subprocess.TimeoutExpired:
                proc.kill()
                proc.wait(timeout=5)


if __name__ == "__main__":
    raise SystemExit(run())
