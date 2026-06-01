from __future__ import annotations

import base64
import json
import uuid
import os
import socket
import struct
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


def check_static_files() -> None:
    for path in [
        "project.config.json",
        "app.json",
        "frontend/pages/room/index.json",
        "frontend/pages/admin/index.json",
        "frontend/pages/legal/index.json",
        "package.json",
    ]:
        json.loads((ROOT / path).read_text(encoding="utf-8"))

    room_js = (ROOT / "frontend" / "pages" / "room" / "index.js").read_text(encoding="utf-8")
    api_js = (ROOT / "frontend" / "services" / "api.js").read_text(encoding="utf-8")
    app_js = (ROOT / "app.js").read_text(encoding="utf-8")
    config_js = (ROOT / "config.js").read_text(encoding="utf-8")
    assert_true("wx.requestSubscribeMessage" in room_js, "room page should request subscribe message permission")
    assert_true("connectRoomSocket" in room_js, "room page should connect websocket")
    assert_true("agreementAccepted" in room_js and "submitReport" in room_js, "room page should require agreement and support reports")
    assert_true("/api/messages/subscribe" in api_js, "api service should save message subscriptions")
    assert_true("/api/reports" in api_js, "api service should submit reports")
    assert_true("/api/admin/users/ban" in api_js, "api service should expose admin ban API")
    assert_true("/api/users/login" in api_js, "api service should support user login")
    assert_true("/ws/room" in api_js, "api service should build room websocket url")
    assert_true("user.profile.updated" in room_js and "user.profile.updated" in api_js, "room page should sync profile updates")
    assert_true("messageTemplateId" in app_js and "messageTemplateId" in config_js, "app config should carry message template id")


def request_json(path: str, headers: dict[str, str] | None = None) -> tuple[int, dict]:
    request = Request(f"http://127.0.0.1:{PORT}{path}", headers=headers or {})
    try:
        with urlopen(request, timeout=5) as response:
            return response.status, json.loads(response.read().decode("utf-8"))
    except HTTPError as exc:
        return exc.code, json.loads(exc.read().decode("utf-8"))


def post_json(path: str, data: dict, headers: dict[str, str] | None = None) -> tuple[int, dict]:
    payload = json.dumps(data, ensure_ascii=False).encode("utf-8")
    request = Request(
        f"http://127.0.0.1:{PORT}{path}",
        data=payload,
        headers={"Content-Type": "application/json", **(headers or {})},
        method="POST",
    )
    try:
        with urlopen(request, timeout=5) as response:
            return response.status, json.loads(response.read().decode("utf-8"))
    except HTTPError as exc:
        return exc.code, json.loads(exc.read().decode("utf-8"))


def post_multipart_file(
    path: str,
    fields: dict[str, str],
    file_field: str,
    filename: str,
    content_type: str,
    content: bytes,
    headers: dict[str, str] | None = None,
) -> tuple[int, dict]:
    boundary = f"----33party{uuid.uuid4().hex}"
    chunks: list[bytes] = []
    for name, value in fields.items():
        chunks.extend([
            f"--{boundary}\r\n".encode("utf-8"),
            f'Content-Disposition: form-data; name="{name}"\r\n\r\n'.encode("utf-8"),
            str(value).encode("utf-8"),
            b"\r\n",
        ])
    chunks.extend([
        f"--{boundary}\r\n".encode("utf-8"),
        f'Content-Disposition: form-data; name="{file_field}"; filename="{filename}"\r\n'.encode("utf-8"),
        f"Content-Type: {content_type}\r\n\r\n".encode("utf-8"),
        content,
        b"\r\n",
        f"--{boundary}--\r\n".encode("utf-8"),
    ])
    payload = b"".join(chunks)
    request = Request(
        f"http://127.0.0.1:{PORT}{path}",
        data=payload,
        headers={
            "Content-Type": f"multipart/form-data; boundary={boundary}",
            "Content-Length": str(len(payload)),
            **(headers or {}),
        },
        method="POST",
    )
    try:
        with urlopen(request, timeout=5) as response:
            return response.status, json.loads(response.read().decode("utf-8"))
    except HTTPError as exc:
        return exc.code, json.loads(exc.read().decode("utf-8"))


def read_ws_frame(sock: socket.socket, initial: bytes = b"") -> tuple[int, dict]:
    buffer = bytearray(initial)

    def take(size: int) -> bytes:
        while len(buffer) < size:
            buffer.extend(sock.recv(size - len(buffer)))
        data = bytes(buffer[:size])
        del buffer[:size]
        return data

    first, second = take(2)
    length = second & 0x7F
    if length == 126:
        length = struct.unpack("!H", take(2))[0]
    elif length == 127:
        length = struct.unpack("!Q", take(8))[0]
    data = take(length)
    return first & 0x0F, json.loads(data.decode("utf-8"))


def connect_room_socket() -> socket.socket:
    sock = socket.create_connection(("127.0.0.1", int(PORT)), timeout=5)
    key = base64.b64encode(os.urandom(16)).decode("ascii")
    request = (
        "GET /ws/room?partyId=party_demo&tableId=table_a01&userId=user_demo_1 HTTP/1.1\r\n"
        "Host: 127.0.0.1\r\n"
        "Upgrade: websocket\r\n"
        "Connection: Upgrade\r\n"
        f"Sec-WebSocket-Key: {key}\r\n"
        "Sec-WebSocket-Version: 13\r\n\r\n"
    )
    sock.sendall(request.encode("utf-8"))
    raw_response = sock.recv(4096)
    headers, _, leftover = raw_response.partition(b"\r\n\r\n")
    response = headers.decode("utf-8", errors="replace")
    assert_true("101 Switching Protocols" in response, "websocket should switch protocols")
    _, body = read_ws_frame(sock, leftover)
    assert_true(body.get("type") == "connected", "websocket should emit connected event")
    return sock


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
    check_static_files()
    subprocess.run([sys.executable, "-m", "py_compile", str(ROOT / "backend" / "server.py")], check=True)

    with tempfile.TemporaryDirectory(prefix="33party-release-") as tmp_dir:
        env = os.environ.copy()
        env.update(
            {
                "PARTY_DB_PATH": str(Path(tmp_dir) / "party.db"),
                "APP_ENV": "production",
                "ADMIN_API_KEY": ADMIN_KEY,
                "PORT": PORT,
                "WECHAT_MESSAGE_TEMPLATE_ID": "test_template_id",
                "DISABLE_WECHAT_SUBSCRIBE_SEND": "1",
                "PUBLIC_API_BASE_URL": f"http://127.0.0.1:{PORT}",
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

            status, body = post_json("/api/users/login", {"code": "release-user-code"})
            assert_true(status == 500 and body.get("ok") is False, "production user login should require real WeChat credentials")

            status, body = post_json(
                "/api/users/profile",
                {
                    "openid": "release_openid_1",
                    "nickname": "Release 用户",
                    "avatarUrl": "https://dummyimage.com/160x160/102826/f6e7c8&text=R",
                    "gender": "unknown",
                    "wechatId": "release_user_wechat",
                },
            )
            assert_true(status == 400 and body.get("ok") is False, "profile API should require agreement and age confirmation")

            status, body = post_json(
                "/api/users/profile",
                {
                    "openid": "release_openid_1",
                    "nickname": "Release 用户",
                    "avatarUrl": "https://dummyimage.com/160x160/102826/f6e7c8&text=R",
                    "gender": "unknown",
                    "wechatId": "release_user_wechat",
                    "agreementAccepted": True,
                    "ageConfirmed": True,
                },
            )
            assert_true(status == 201 and body.get("ok") is True, "user profile API should create user")
            assert_true(body["user"]["agreementAcceptedAt"] and body["user"]["ageConfirmedAt"], "profile should persist agreement state")
            release_user_id = body["user"]["id"]

            status, body = post_json(
                "/api/users/profile",
                {
                    "id": release_user_id,
                    "nickname": "Release 用户二次保存",
                    "avatarUrl": "https://dummyimage.com/160x160/102826/f6e7c8&text=R2",
                    "gender": "unknown",
                    "agreementAccepted": True,
                    "ageConfirmed": True,
                },
            )
            assert_true(status == 201 and body["user"]["id"] == release_user_id, "profile API should update cached user id without duplicate insert")

            status, body = post_json(
                "/api/users/profile",
                {
                    "openid": "release_openid_2",
                    "nickname": "Release 用户二号",
                    "avatarUrl": "https://dummyimage.com/160x160/102826/f6e7c8&text=R3",
                    "gender": "unknown",
                    "agreementAccepted": True,
                    "ageConfirmed": True,
                },
            )
            assert_true(status == 201 and body.get("ok") is True, "profile API should create a second user")
            second_user_id = body["user"]["id"]

            status, body = post_json(
                "/api/users/profile",
                {
                    "id": release_user_id,
                    "openid": "release_openid_2",
                    "nickname": "Release 用户二号刷新",
                    "avatarUrl": "https://dummyimage.com/160x160/102826/f6e7c8&text=R4",
                    "gender": "unknown",
                    "agreementAccepted": True,
                    "ageConfirmed": True,
                },
            )
            assert_true(
                status == 201 and body["user"]["id"] == second_user_id,
                "profile API should prefer openid when cached id belongs to another user",
            )

            status, body = post_json(
                "/api/party/join",
                {
                    "partyId": "party_demo",
                    "tableId": "table_a01",
                    "userId": release_user_id,
                },
            )
            assert_true(status == 201 and body.get("ok") is True, "join party API should work")
            release_member_id = body["memberId"]
            assert_true(body["room"]["table"]["id"] == "table_a01", "joined room should be table_a01")

            status, body = request_json("/api/room?partyId=party_demo&tableId=table_a01&userId=user_demo_1")
            assert_true(status == 200 and body.get("ok") is True, "room API should return ok")
            messages = body["room"]["messages"]
            user_message = next(message for message in messages if message["senderType"] == "user")
            assert_true(user_message["sender"].get("memberId"), "user message sender should include memberId")

            status, body = request_json("/api/config")
            assert_true(status == 200 and body.get("messageTemplateId") == "test_template_id", "config should expose subscribe template id")

            status, body = post_json(
                "/api/messages/subscribe",
                {
                    "partyId": "party_demo",
                    "tableId": "table_a01",
                    "userId": "user_demo_2",
                    "templateId": "test_template_id",
                    "status": "accepted",
                },
            )
            assert_true(status == 201 and body.get("ok") is True, "message subscription should be saved")
            assert_true(body["subscription"]["enabled"] == 1, "accepted subscription should be enabled")

            status, body = post_multipart_file(
                "/api/uploads",
                {"mediaType": "photo"},
                "file",
                "release.jpg",
                "image/jpeg",
                b"release-image-bytes",
            )
            assert_true(status == 201 and body.get("ok") is True, "upload API should accept image")
            assert_true(body["mediaUrl"].startswith(f"http://127.0.0.1:{PORT}/uploads/photo/"), "upload should return public media url")
            uploaded_path = body["mediaUrl"].split(f"http://127.0.0.1:{PORT}", 1)[1]
            with urlopen(f"http://127.0.0.1:{PORT}{uploaded_path}", timeout=5) as response:
                assert_true(response.status == 200 and response.read() == b"release-image-bytes", "uploaded file should be served")

            status, body = post_json(
                "/api/photo-burst",
                {
                    "partyId": "party_demo",
                    "tableId": "table_a01",
                    "senderType": "user",
                    "senderId": "user_demo_1",
                    "mediaUrl": uploaded_path,
                    "isFlash": True,
                    "flashSeconds": 5,
                },
            )
            assert_true(status == 201 and body.get("ok") is True, "photo burst API should create flash photo")
            assert_true(body["message"]["kind"] == "photo" and body["message"]["isFlash"] is True, "photo burst should be normalized as flash photo")
            assert_true(bool(body["message"]["flashExpiresAt"]), "flash photo should have expiry")

            sock = connect_room_socket()
            try:
                status, body = post_json(
                    "/api/messages",
                    {
                        "partyId": "party_demo",
                        "tableId": "table_a01",
                        "senderType": "user",
                        "senderId": "user_demo_1",
                        "kind": "text",
                        "text": "release check realtime",
                    },
                )
                assert_true(status == 201 and body.get("ok") is True, "message API should create text message")
                realtime_message_id = body["message"]["id"]
                _, event = read_ws_frame(sock)
                assert_true(event.get("type") == "message.created", "websocket should receive message.created")
                assert_true(event["message"]["text"] == "release check realtime", "websocket message should match posted message")

                status, body = post_json(
                    "/api/users/profile",
                    {
                        "id": "user_demo_1",
                        "nickname": "Release Demo 新名",
                        "avatarUrl": "https://dummyimage.com/160x160/102826/f6e7c8&text=RD",
                        "gender": "female",
                        "agreementAccepted": True,
                        "ageConfirmed": True,
                    },
                )
                assert_true(status == 201 and body.get("ok") is True, "profile update should save for joined user")
                _, event = read_ws_frame(sock)
                assert_true(event.get("type") == "user.profile.updated", "websocket should receive user.profile.updated")
                assert_true(event["user"]["nickname"] == "Release Demo 新名", "profile websocket payload should carry new nickname")
            finally:
                sock.close()

            status, body = post_json(
                "/api/reports",
                {
                    "partyId": "party_demo",
                    "tableId": "table_a01",
                    "reporterType": "user",
                    "reporterId": release_user_id,
                    "targetType": "message",
                    "targetId": realtime_message_id,
                    "reason": "骚扰辱骂",
                },
            )
            assert_true(status == 201 and body.get("ok") is True, "user should report a message")
            message_report_id = body["report"]["id"]

            status, body = post_json(
                "/api/reports",
                {
                    "partyId": "party_demo",
                    "tableId": "table_a01",
                    "reporterType": "user",
                    "reporterId": release_user_id,
                    "targetType": "user",
                    "targetId": "user_demo_2",
                    "reason": "诈骗引流",
                },
            )
            assert_true(status == 201 and body.get("ok") is True, "user should report another user")

            status, body = post_json("/api/messages/like", {"messageId": user_message["id"]})
            assert_true(status == 201 and body.get("ok") is True, "message like API should work")
            assert_true(body["message"]["likeCount"] >= 1, "message like count should increase")

            status, body = post_json(
                "/api/contact/request",
                {
                    "partyId": "party_demo",
                    "requesterType": "user",
                    "requesterId": "user_demo_1",
                    "targetType": "admin",
                    "targetId": "admin_mimei",
                },
            )
            assert_true(status == 201 and body.get("ok") is True, "user should contact admin")

            status, body = post_json(
                "/api/contact/request",
                {
                    "partyId": "party_demo",
                    "requesterType": "user",
                    "requesterId": "user_demo_1",
                    "targetType": "user",
                    "targetId": "user_demo_2",
                },
            )
            assert_true(status == 403 and body.get("ok") is False, "user-to-user contact should be rejected")

            status, body = request_json("/api/admin/tables?partyId=party_demo&adminId=admin_mimei")
            assert_true(status == 401 and body.get("ok") is False, "admin API should reject missing key")

            status, body = request_json(
                "/api/admin/tables?partyId=party_demo&adminId=admin_mimei",
                headers={"X-Admin-Key": ADMIN_KEY},
            )
            assert_true(status == 200 and body.get("ok") is True, "admin API should accept valid key")

            admin_headers = {"X-Admin-Key": ADMIN_KEY}
            status, body = request_json(
                "/api/admin/reports?partyId=party_demo&adminId=admin_mimei&status=pending",
                headers=admin_headers,
            )
            assert_true(status == 200 and len(body.get("reports", [])) >= 2, "admin should list pending reports")

            status, body = post_json(
                "/api/admin/messages/delete",
                {"adminId": "admin_mimei", "messageId": realtime_message_id, "reason": "违规内容"},
                headers=admin_headers,
            )
            assert_true(status == 200 and body["message"]["isDeleted"] is True, "admin should delete message")

            status, body = request_json("/api/room?partyId=party_demo&tableId=table_a01&userId=release_user_id")
            deleted_message = next(message for message in body["room"]["messages"] if message["id"] == realtime_message_id)
            assert_true(deleted_message["text"] == "该消息已被管理员删除", "room API should hide deleted message body")

            status, body = post_json(
                "/api/admin/users/ban",
                {"adminId": "admin_mimei", "partyId": "party_demo", "userId": release_user_id, "reason": "违规使用"},
                headers=admin_headers,
            )
            assert_true(status == 200 and body["user"]["bannedAt"], "admin should ban user")

            status, body = post_json(
                "/api/messages",
                {
                    "partyId": "party_demo",
                    "tableId": "table_a01",
                    "senderType": "user",
                    "senderId": release_user_id,
                    "kind": "text",
                    "text": "blocked after ban",
                },
            )
            assert_true(status == 403 and body.get("error") == "账号已被限制使用", "banned user should not send messages")

            status, body = post_json(
                "/api/party/join",
                {
                    "partyId": "party_demo",
                    "tableId": "table_a01",
                    "userId": release_user_id,
                },
            )
            assert_true(status == 403 and body.get("error") == "账号已被限制使用", "banned user should not join")

            status, body = post_json(
                "/api/admin/users/unban",
                {"adminId": "admin_mimei", "partyId": "party_demo", "userId": release_user_id},
                headers=admin_headers,
            )
            assert_true(status == 200 and not body["user"]["bannedAt"], "admin should unban user")

            status, body = post_json(
                "/api/messages",
                {
                    "partyId": "party_demo",
                    "tableId": "table_a01",
                    "senderType": "user",
                    "senderId": release_user_id,
                    "kind": "text",
                    "text": "release check after unban",
                },
            )
            assert_true(status == 201 and body.get("ok") is True, "unbanned user should send messages again")

            status, body = post_json(
                "/api/admin/reports/resolve",
                {"adminId": "admin_mimei", "reportId": message_report_id, "status": "resolved"},
                headers=admin_headers,
            )
            assert_true(status == 200 and body["report"]["status"] == "resolved", "admin should resolve report")

            status, body = request_json(
                "/api/admin/tables/invite?tableId=table_a01&adminId=admin_mimei",
                headers=admin_headers,
            )
            assert_true(status == 200 and body.get("scene") == "table_a01", "admin invite API should return table scene")
            assert_true(body["qrcodeUrl"].endswith("/api/admin/tables/qrcode?tableId=table_a01&adminId=admin_mimei"), "invite should expose qrcode url")

            status, body = post_json(
                "/api/admin/members/seat",
                {"memberId": release_member_id, "seatStatus": "seated"},
                headers=admin_headers,
            )
            assert_true(status == 200 and body.get("seatStatus") == "seated", "admin should seat member")

            status, body = post_json(
                "/api/admin/tables/head",
                {"tableId": "table_a01", "memberId": release_member_id},
                headers=admin_headers,
            )
            assert_true(status == 200 and body["table"]["headMemberId"] == release_member_id, "admin should set table head")

            status, body = post_json(
                "/api/admin/profile",
                {"adminId": "admin_mimei", "displayName": "Release 管理员", "wechatId": "release_admin_wechat"},
                headers=admin_headers,
            )
            assert_true(status == 200 and body["admin"]["wechatId"] == "release_admin_wechat", "admin profile should update")

            status, body = post_json(
                "/api/admin/parties",
                {
                    "adminId": "admin_mimei",
                    "title": "Release Test Party",
                    "tableNo": "R01",
                    "capacity": 6,
                    "barName": "Release Lounge",
                    "barAddress": "Release Address",
                },
                headers=admin_headers,
            )
            assert_true(status == 201 and body.get("ok") is True, "admin should create party")
            assert_true(body["tables"][0]["capacity"] == 6, "created table capacity should match")

            status, body = post_json("/api/admin/members/kick", {"memberId": release_member_id}, headers=admin_headers)
            assert_true(status == 200 and body.get("ok") is True, "admin should kick member")

            status, body = post_json("/api/admin/cleanup", {}, headers=admin_headers)
            assert_true(status == 200 and body.get("ok") is True, "admin cleanup should run")

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
