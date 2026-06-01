from __future__ import annotations

import json
import os
import sqlite3
import sys
import time
import uuid
import secrets
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlparse
from urllib.request import Request, urlopen
from urllib.error import HTTPError, URLError


ROOT = Path(__file__).resolve().parent
DB_PATH = Path(os.environ.get("PARTY_DB_PATH", ROOT / "party.db"))
DEFAULT_PORT = int(os.environ.get("PORT", "7892"))
DEFAULT_HOST = os.environ.get("HOST", "127.0.0.1")
APP_ENV = os.environ.get("APP_ENV", "development").lower()
ADMIN_API_KEY = os.environ.get("ADMIN_API_KEY", "")
PUBLIC_API_BASE_URL = os.environ.get("PUBLIC_API_BASE_URL", "")
MINIPROGRAM_APPID = os.environ.get("WECHAT_MINIPROGRAM_APPID", "")
MINIPROGRAM_SECRET = os.environ.get("WECHAT_MINIPROGRAM_SECRET", "")
MINIPROGRAM_ENV_VERSION = os.environ.get("WECHAT_MINIPROGRAM_ENV_VERSION", "release")
REQUIRE_ADMIN_AUTH = os.environ.get("REQUIRE_ADMIN_AUTH", "1" if APP_ENV == "production" else "0").lower() in {
    "1",
    "true",
    "yes",
}
MINIPROGRAM_ROOM_PAGE = "frontend/pages/room/index"
MINIPROGRAM_ADMIN_PAGE = "frontend/pages/admin/index"
TOKEN_CACHE = {"access_token": "", "expires_at": 0}
ONLINE_WINDOW_SECONDS = int(os.environ.get("ONLINE_WINDOW_SECONDS", "300"))


def now_sql() -> str:
    return "datetime('now', '+8 hours')"


def new_id(prefix: str) -> str:
    return f"{prefix}_{uuid.uuid4().hex[:12]}"


def connect() -> sqlite3.Connection:
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    return conn


def row_to_dict(row: sqlite3.Row | None) -> dict | None:
    if row is None:
        return None
    return {key: row[key] for key in row.keys()}


def rows_to_dicts(rows: list[sqlite3.Row]) -> list[dict]:
    return [row_to_dict(row) for row in rows]


def http_json(url: str, data: dict | None = None, timeout: int = 15) -> dict:
    payload = None
    headers = {"Content-Type": "application/json"}
    method = "GET"
    if data is not None:
        payload = json.dumps(data, ensure_ascii=False).encode("utf-8")
        method = "POST"
    request = Request(url, data=payload, headers=headers, method=method)
    try:
        with urlopen(request, timeout=timeout) as response:
            raw = response.read().decode("utf-8")
    except HTTPError as exc:
        raw = exc.read().decode("utf-8", errors="replace")
        raise ApiError(exc.code, f"微信接口请求失败: {raw}") from exc
    except URLError as exc:
        raise ApiError(502, f"微信接口连接失败: {exc.reason}") from exc
    try:
        result = json.loads(raw)
    except json.JSONDecodeError as exc:
        raise ApiError(502, f"微信接口返回非 JSON: {raw[:120]}") from exc
    errcode = result.get("errcode")
    if errcode not in (None, 0):
        raise ApiError(502, f"微信接口错误 {errcode}: {result.get('errmsg', '')}")
    return result


def http_bytes(url: str, data: dict, timeout: int = 20) -> tuple[bytes, str]:
    payload = json.dumps(data, ensure_ascii=False).encode("utf-8")
    request = Request(url, data=payload, headers={"Content-Type": "application/json"}, method="POST")
    try:
        with urlopen(request, timeout=timeout) as response:
            content_type = response.headers.get("Content-Type", "application/octet-stream")
            body = response.read()
    except HTTPError as exc:
        raw = exc.read().decode("utf-8", errors="replace")
        raise ApiError(exc.code, f"微信接口请求失败: {raw}") from exc
    except URLError as exc:
        raise ApiError(502, f"微信接口连接失败: {exc.reason}") from exc
    if body[:1] == b"{":
        try:
            result = json.loads(body.decode("utf-8"))
        except json.JSONDecodeError:
            result = {}
        errcode = result.get("errcode")
        if errcode not in (None, 0):
            raise ApiError(502, f"微信接口错误 {errcode}: {result.get('errmsg', '')}")
    return body, content_type


def get_wechat_access_token() -> str:
    if not MINIPROGRAM_APPID or not MINIPROGRAM_SECRET:
        raise ApiError(500, "缺少 WECHAT_MINIPROGRAM_APPID 或 WECHAT_MINIPROGRAM_SECRET")
    now = int(time.time())
    if TOKEN_CACHE["access_token"] and TOKEN_CACHE["expires_at"] - 120 > now:
        return TOKEN_CACHE["access_token"]
    url = (
        "https://api.weixin.qq.com/cgi-bin/token"
        f"?grant_type=client_credential&appid={MINIPROGRAM_APPID}&secret={MINIPROGRAM_SECRET}"
    )
    result = http_json(url)
    TOKEN_CACHE["access_token"] = result["access_token"]
    TOKEN_CACHE["expires_at"] = now + int(result.get("expires_in", 7200))
    return TOKEN_CACHE["access_token"]


def code_to_openid(code: str) -> str:
    if not MINIPROGRAM_APPID or not MINIPROGRAM_SECRET:
        raise ApiError(500, "缺少 WECHAT_MINIPROGRAM_APPID 或 WECHAT_MINIPROGRAM_SECRET")
    url = (
        "https://api.weixin.qq.com/sns/jscode2session"
        f"?appid={MINIPROGRAM_APPID}&secret={MINIPROGRAM_SECRET}&js_code={code}&grant_type=authorization_code"
    )
    result = http_json(url)
    openid = result.get("openid")
    if not openid:
        raise ApiError(502, "微信登录未返回 openid")
    return openid


def init_db(seed: bool = True) -> None:
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    with connect() as conn:
        conn.executescript((ROOT / "schema.sql").read_text(encoding="utf-8"))
        migrate_db(conn)
        if seed:
            seed_db(conn)


def add_column_if_missing(conn: sqlite3.Connection, table: str, column: str, definition: str) -> None:
    columns = {row["name"] for row in conn.execute(f"PRAGMA table_info({table})").fetchall()}
    if column not in columns:
        conn.execute(f"ALTER TABLE {table} ADD COLUMN {column} {definition}")


def migrate_db(conn: sqlite3.Connection) -> None:
    add_column_if_missing(conn, "admins", "openid", "TEXT")
    add_column_if_missing(conn, "users", "gender", "TEXT NOT NULL DEFAULT 'unknown'")
    add_column_if_missing(conn, "party_members", "seat_status", "TEXT NOT NULL DEFAULT 'ghost'")
    add_column_if_missing(conn, "party_tables", "head_member_id", "TEXT REFERENCES party_members(id) ON DELETE SET NULL")
    add_column_if_missing(conn, "messages", "like_count", "INTEGER NOT NULL DEFAULT 0")
    add_column_if_missing(conn, "messages", "is_flash", "INTEGER NOT NULL DEFAULT 0")
    add_column_if_missing(conn, "messages", "flash_expires_at", "TEXT")
    add_column_if_missing(conn, "messages", "quote_message_id", "TEXT")
    add_column_if_missing(conn, "messages", "quote_sender", "TEXT")
    add_column_if_missing(conn, "messages", "quote_kind", "TEXT")
    add_column_if_missing(conn, "messages", "quote_text", "TEXT")
    add_column_if_missing(conn, "messages", "quote_media_url", "TEXT")
    add_column_if_missing(conn, "messages", "quote_duration_seconds", "INTEGER")
    migrate_messages_video_kind(conn)
    conn.execute("UPDATE users SET gender = 'female' WHERE id = 'user_demo_1' AND gender = 'unknown'")
    conn.execute("UPDATE users SET gender = 'male' WHERE id = 'user_demo_2' AND gender = 'unknown'")
    conn.execute("UPDATE party_members SET seat_status = 'seated' WHERE id = 'member_demo_1'")
    conn.execute("UPDATE messages SET kind = 'photo' WHERE kind = 'photo_burst'")
    conn.execute("UPDATE messages SET text = REPLACE(text, '爆照一下，', '') WHERE text LIKE '%爆照一下%'")
    conn.execute("CREATE UNIQUE INDEX IF NOT EXISTS idx_admins_openid ON admins(openid)")


def migrate_messages_video_kind(conn: sqlite3.Connection) -> None:
    table_sql = conn.execute(
        "SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'messages'"
    ).fetchone()
    if not table_sql or "'video'" in (table_sql["sql"] or ""):
        return
    conn.executescript(
        """
        ALTER TABLE messages RENAME TO messages_old;
        CREATE TABLE messages (
          id TEXT PRIMARY KEY,
          party_id TEXT NOT NULL REFERENCES parties(id),
          table_id TEXT NOT NULL REFERENCES party_tables(id),
          sender_type TEXT NOT NULL CHECK(sender_type IN ('user', 'admin')),
          sender_id TEXT NOT NULL,
          kind TEXT NOT NULL CHECK(kind IN ('text', 'voice', 'photo', 'video', 'system', 'photo_burst')),
          text TEXT,
          media_url TEXT,
          duration_seconds INTEGER,
          quote_message_id TEXT,
          quote_sender TEXT,
          quote_kind TEXT,
          quote_text TEXT,
          quote_media_url TEXT,
          quote_duration_seconds INTEGER,
          like_count INTEGER NOT NULL DEFAULT 0,
          is_flash INTEGER NOT NULL DEFAULT 0,
          flash_expires_at TEXT,
          created_at TEXT NOT NULL DEFAULT (datetime('now', '+8 hours'))
        );
        INSERT INTO messages
          (id, party_id, table_id, sender_type, sender_id, kind, text, media_url,
           duration_seconds, quote_message_id, quote_sender, quote_kind, quote_text,
           quote_media_url, quote_duration_seconds, like_count, is_flash, flash_expires_at, created_at)
        SELECT
          id, party_id, table_id, sender_type, sender_id, kind, text, media_url,
          duration_seconds, quote_message_id, quote_sender, quote_kind, quote_text,
          quote_media_url, quote_duration_seconds, like_count, is_flash, flash_expires_at, created_at
        FROM messages_old;
        DROP TABLE messages_old;
        CREATE INDEX IF NOT EXISTS idx_messages_room ON messages(party_id, table_id, id);
        """
    )


def seed_db(conn: sqlite3.Connection) -> None:
    bar = conn.execute("SELECT id FROM bars WHERE id = ?", ("bar_demo",)).fetchone()
    if bar:
        return

    conn.execute(
        """
        INSERT INTO bars (id, name, address, latitude, longitude)
        VALUES (?, ?, ?, ?, ?)
        """,
        ("bar_demo", "33 Party Lounge", "深圳市南山区后海中心路 33 Party Lounge", 22.518, 113.943),
    )
    conn.execute(
        """
        INSERT INTO admins (id, bar_id, openid, display_name, avatar_url, wechat_id, wechat_qr_url)
        VALUES (?, ?, ?, ?, ?, ?, ?)
        """,
        (
            "admin_mimei",
            "bar_demo",
            None,
            "Mia 局头",
            "https://dummyimage.com/160x160/102826/f6e7c8&text=M",
            "mia_party33",
            "https://dummyimage.com/360x360/f6e7c8/102826&text=WeChat+QR",
        ),
    )
    conn.execute(
        """
        INSERT INTO parties (id, bar_id, admin_id, title, scene_code, starts_at)
        VALUES (?, ?, ?, ?, ?, datetime('now', '+9 hours'))
        """,
        ("party_demo", "bar_demo", "admin_mimei", "周六拼台主局", "party_demo"),
    )

    tables = [
        ("table_a01", "A01", 8, "table_a01"),
        ("table_a02", "A02", 6, "table_a02"),
        ("table_b08", "B08", 10, "table_b08"),
    ]
    conn.executemany(
        """
        INSERT INTO party_tables (id, party_id, table_no, capacity, share_scene)
        VALUES (?, 'party_demo', ?, ?, ?)
        """,
        tables,
    )

    users = [
        (
            "user_demo_1",
            "openid_demo_1",
            "Luna",
            "https://dummyimage.com/160x160/e95f5c/101918&text=L",
            "female",
            "luna_33",
            1,
        ),
        (
            "user_demo_2",
            "openid_demo_2",
            "Kai",
            "https://dummyimage.com/160x160/35c2a1/101918&text=K",
            "male",
            "kai_live",
            1,
        ),
    ]
    conn.executemany(
        """
        INSERT INTO users (id, openid, nickname, avatar_url, gender, wechat_id, profile_complete)
        VALUES (?, ?, ?, ?, ?, ?, ?)
        """,
        users,
    )
    conn.executemany(
        """
        INSERT INTO party_members (id, party_id, table_id, user_id, role, seat_status)
        VALUES (?, 'party_demo', ?, ?, 'guest', ?)
        """,
        [
            ("member_demo_1", "table_a01", "user_demo_1", "seated"),
            ("member_demo_2", "table_a01", "user_demo_2", "ghost"),
        ],
    )
    conn.execute("UPDATE party_members SET role = 'head' WHERE id = 'member_demo_1'")
    conn.execute("UPDATE party_tables SET head_member_id = 'member_demo_1' WHERE id = 'table_a01'")
    conn.executemany(
        """
        INSERT INTO messages (id, party_id, table_id, sender_type, sender_id, kind, text, media_url, duration_seconds)
        VALUES (?, 'party_demo', 'table_a01', ?, ?, ?, ?, ?, ?)
        """,
        [
            ("msg_demo_1", "admin", "admin_mimei", "system", "今晚 A01 已开局，想拼台直接进。", None, None),
            ("msg_demo_2", "user", "user_demo_1", "text", "我和朋友两个人，想坐靠舞台一点。", None, None),
            ("msg_demo_3", "user", "user_demo_2", "photo", "现场灯光不错。", "https://dummyimage.com/900x1200/102826/f6e7c8&text=Party", None),
        ],
    )


class ApiError(Exception):
    def __init__(self, status: int, message: str):
        super().__init__(message)
        self.status = status
        self.message = message


class PartyHandler(BaseHTTPRequestHandler):
    server_version = "PartyBackend/0.1"

    def do_OPTIONS(self) -> None:
        self.send_response(204)
        self.send_cors_headers()
        self.end_headers()

    def do_GET(self) -> None:
        self.handle_request("GET")

    def do_POST(self) -> None:
        self.handle_request("POST")

    def handle_request(self, method: str) -> None:
        try:
            parsed = urlparse(self.path)
            path = parsed.path.rstrip("/") or "/"
            query = {key: values[-1] for key, values in parse_qs(parsed.query).items()}
            body = self.read_json_body() if method == "POST" else {}

            if method == "GET" and path == "/health":
                self.respond({"ok": True, "service": "33party-backend"})
            elif method == "GET" and path == "/api/config":
                self.respond({
                    "ok": True,
                    "roomPage": MINIPROGRAM_ROOM_PAGE,
                    "adminPage": MINIPROGRAM_ADMIN_PAGE,
                    "envVersion": MINIPROGRAM_ENV_VERSION,
                })
            elif method == "GET" and path == "/api/party/by-scene":
                self.respond(self.get_party_by_scene(query))
            elif method == "POST" and path == "/api/admin/login":
                self.respond(self.admin_login(body))
            elif method == "POST" and path == "/api/admin/bind-openid":
                self.respond(self.bind_admin_openid(body))
            elif method == "POST" and path == "/api/users/profile":
                self.respond(self.upsert_profile(body), status=201)
            elif method == "POST" and path == "/api/party/join":
                self.respond(self.join_party(body), status=201)
            elif method == "GET" and path == "/api/room":
                self.respond(self.get_room(query))
            elif method == "GET" and path == "/api/messages":
                self.respond(self.get_messages(query))
            elif method == "POST" and path == "/api/messages":
                self.respond(self.create_message(body), status=201)
            elif method == "POST" and path == "/api/messages/like":
                self.respond(self.like_message(body), status=201)
            elif method == "POST" and path == "/api/photo-burst":
                self.respond(self.create_photo_burst(body), status=201)
            elif method == "GET" and path == "/api/admin/tables":
                self.respond(self.get_admin_tables(query))
            elif method == "GET" and path == "/api/admin/tables/invite":
                self.respond(self.get_table_invite(query))
            elif method == "GET" and path == "/api/admin/tables/qrcode":
                self.respond_bytes(*self.get_table_qrcode(query))
            elif method == "POST" and path == "/api/admin/profile":
                self.respond(self.update_admin_profile(body))
            elif method == "POST" and path == "/api/admin/parties":
                self.respond(self.create_admin_party(body), status=201)
            elif method == "POST" and path == "/api/admin/members/seat":
                self.respond(self.set_member_seat_status(body))
            elif method == "POST" and path == "/api/admin/tables/head":
                self.respond(self.set_table_head(body))
            elif method == "POST" and path == "/api/admin/members/kick":
                self.respond(self.kick_member(body))
            elif method == "POST" and path == "/api/contact/request":
                self.respond(self.request_contact(body), status=201)
            else:
                raise ApiError(404, "接口不存在")
        except ApiError as exc:
            self.respond({"ok": False, "error": exc.message}, status=exc.status)
        except Exception as exc:  # pragma: no cover - keeps local dev debuggable.
            self.respond({"ok": False, "error": str(exc)}, status=500)

    def read_json_body(self) -> dict:
        length = int(self.headers.get("Content-Length", "0"))
        if length == 0:
            return {}
        raw = self.rfile.read(length)
        try:
            return json.loads(raw.decode("utf-8"))
        except json.JSONDecodeError as exc:
            raise ApiError(400, f"JSON 格式错误: {exc}") from exc

    def respond(self, data: dict, status: int = 200) -> None:
        payload = json.dumps(data, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_cors_headers()
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(payload)))
        self.end_headers()
        self.wfile.write(payload)

    def respond_bytes(self, body: bytes, content_type: str, status: int = 200) -> None:
        self.send_response(status)
        self.send_cors_headers()
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def send_cors_headers(self) -> None:
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type, X-Admin-Key, X-Admin-Token")

    def get_party_by_scene(self, query: dict) -> dict:
        scene = require(query, "scene")
        with connect() as conn:
            table = conn.execute("SELECT * FROM party_tables WHERE share_scene = ?", (scene,)).fetchone()
            if table:
                party_id = table["party_id"]
                table_id = table["id"]
            else:
                party = conn.execute("SELECT * FROM parties WHERE scene_code = ?", (scene,)).fetchone()
                if not party:
                    raise ApiError(404, "找不到对应主局")
                party_id = party["id"]
                first_table = conn.execute(
                    "SELECT id FROM party_tables WHERE party_id = ? ORDER BY table_no LIMIT 1",
                    (party_id,),
                ).fetchone()
                table_id = first_table["id"] if first_table else None
            return {"ok": True, "party": self.load_party(conn, party_id), "defaultTableId": table_id}

    def admin_login(self, body: dict) -> dict:
        admin_id = body.get("adminId", "admin_mimei")
        code = require(body, "code")
        openid = code_to_openid(code)
        with connect() as conn:
            admin = conn.execute("SELECT * FROM admins WHERE id = ?", (admin_id,)).fetchone()
            if not admin:
                raise ApiError(404, "管理员不存在")
            if admin["openid"] and admin["openid"] != openid:
                raise ApiError(403, "当前微信不是该管理员")
            if not admin["openid"]:
                raise ApiError(403, "管理员微信未绑定，请使用管理员密钥完成首次绑定")
            token = secrets.token_urlsafe(32)
            expires_at = int(time.time()) + 86400 * 14
            conn.execute(
                """
                INSERT INTO admin_sessions (token, admin_id, openid, expires_at)
                VALUES (?, ?, ?, ?)
                """,
                (token, admin_id, openid, expires_at),
            )
            return {
                "ok": True,
                "admin": public_admin(admin),
                "token": token,
                "expiresAt": expires_at,
            }

    def bind_admin_openid(self, body: dict) -> dict:
        self.require_admin_request(body)
        admin_id = body.get("adminId", "admin_mimei")
        code = require(body, "code")
        openid = code_to_openid(code)
        with connect() as conn:
            admin = conn.execute("SELECT * FROM admins WHERE id = ?", (admin_id,)).fetchone()
            if not admin:
                raise ApiError(404, "管理员不存在")
            if admin["openid"] and admin["openid"] != openid:
                raise ApiError(403, "当前微信不是该管理员")
            conn.execute("UPDATE admins SET openid = ? WHERE id = ?", (openid, admin_id))
            updated = conn.execute("SELECT * FROM admins WHERE id = ?", (admin_id,)).fetchone()
            token = secrets.token_urlsafe(32)
            expires_at = int(time.time()) + 86400 * 14
            conn.execute(
                """
                INSERT INTO admin_sessions (token, admin_id, openid, expires_at)
                VALUES (?, ?, ?, ?)
                """,
                (token, admin_id, openid, expires_at),
            )
            return {
                "ok": True,
                "admin": public_admin(updated),
                "token": token,
                "expiresAt": expires_at,
            }

    def upsert_profile(self, body: dict) -> dict:
        openid = body.get("openid") or f"mock_{uuid.uuid4().hex[:10]}"
        nickname = body.get("nickname") or "新朋友"
        user_id = body.get("id") or f"user_{uuid.uuid5(uuid.NAMESPACE_URL, openid).hex[:12]}"
        avatar_url = body.get("avatarUrl") or body.get("avatar_url")
        wechat_id = body.get("wechatId") or body.get("wechat_id")
        gender = body.get("gender") or "unknown"
        phone = body.get("phone")
        profile_complete = 1 if nickname and avatar_url else 0

        with connect() as conn:
            existing = conn.execute("SELECT id FROM users WHERE openid = ?", (openid,)).fetchone()
            if existing:
                user_id = existing["id"]
                conn.execute(
                    """
                    UPDATE users
                    SET nickname = ?, avatar_url = ?, gender = ?, phone = ?, wechat_id = ?,
                        profile_complete = ?, updated_at = datetime('now', '+8 hours')
                    WHERE id = ?
                    """,
                    (nickname, avatar_url, gender, phone, wechat_id, profile_complete, user_id),
                )
            else:
                conn.execute(
                    """
                    INSERT INTO users (id, openid, nickname, avatar_url, gender, phone, wechat_id, profile_complete)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                    """,
                    (user_id, openid, nickname, avatar_url, gender, phone, wechat_id, profile_complete),
                )
            user = conn.execute("SELECT * FROM users WHERE id = ?", (user_id,)).fetchone()
            return {"ok": True, "user": public_user(user)}

    def join_party(self, body: dict) -> dict:
        party_id = require(body, "partyId")
        user_id = require(body, "userId")
        table_id = body.get("tableId")

        with connect() as conn:
            party = conn.execute("SELECT * FROM parties WHERE id = ?", (party_id,)).fetchone()
            if not party:
                raise ApiError(404, "主局不存在")
            user = conn.execute("SELECT * FROM users WHERE id = ?", (user_id,)).fetchone()
            if not user:
                raise ApiError(404, "用户不存在，请先完善资料")
            if not table_id:
                table = conn.execute(
                    "SELECT id FROM party_tables WHERE party_id = ? ORDER BY table_no LIMIT 1",
                    (party_id,),
                ).fetchone()
                table_id = table["id"] if table else None
            table = conn.execute(
                "SELECT * FROM party_tables WHERE id = ? AND party_id = ?",
                (table_id, party_id),
            ).fetchone()
            if not table:
                raise ApiError(404, "桌台不存在")

            existing = conn.execute(
                "SELECT id FROM party_members WHERE party_id = ? AND user_id = ?",
                (party_id, user_id),
            ).fetchone()
            if existing:
                conn.execute(
                    """
                    UPDATE party_members
                    SET table_id = ?, seat_status = 'ghost', last_seen_at = datetime('now', '+8 hours')
                    WHERE id = ?
                    """,
                    (table_id, existing["id"]),
                )
                member_id = existing["id"]
            else:
                member_id = new_id("member")
                conn.execute(
                    """
                    INSERT INTO party_members (id, party_id, table_id, user_id)
                    VALUES (?, ?, ?, ?)
                    """,
                    (member_id, party_id, table_id, user_id),
                )
                conn.execute(
                    """
                    INSERT INTO messages (id, party_id, table_id, sender_type, sender_id, kind, text)
                    VALUES (?, ?, ?, 'user', ?, 'system', ?)
                    """,
                    (new_id("msg"), party_id, table_id, user_id, f"{user['nickname']} 加入了 {table['table_no']}"),
                )
            return {"ok": True, "memberId": member_id, "room": self.load_room(conn, party_id, table_id, user_id)}

    def get_room(self, query: dict) -> dict:
        party_id = require(query, "partyId")
        table_id = require(query, "tableId")
        user_id = query.get("userId")
        with connect() as conn:
            if user_id:
                self.touch_member(conn, party_id, table_id, user_id)
            return {"ok": True, "room": self.load_room(conn, party_id, table_id, user_id)}

    def get_messages(self, query: dict) -> dict:
        party_id = require(query, "partyId")
        table_id = require(query, "tableId")
        after_id = query.get("afterId")
        params: list = [party_id, table_id]
        where = "party_id = ? AND table_id = ?"
        if after_id:
            where += " AND id > ?"
            params.append(after_id)
        with connect() as conn:
            rows = conn.execute(
                f"SELECT * FROM messages WHERE {where} ORDER BY created_at ASC, id ASC LIMIT 80",
                params,
            ).fetchall()
            return {"ok": True, "messages": [self.decorate_message(conn, row) for row in rows]}

    def create_message(self, body: dict) -> dict:
        party_id = require(body, "partyId")
        table_id = require(body, "tableId")
        sender_type = body.get("senderType", "user")
        sender_id = require(body, "senderId")
        kind = body.get("kind", "text")
        if kind not in {"text", "voice", "photo", "video", "system", "photo_burst"}:
            raise ApiError(400, "不支持的消息类型")

        with connect() as conn:
            self.ensure_sender(conn, sender_type, sender_id)
            if sender_type == "user":
                self.touch_member(conn, party_id, table_id, sender_id)
            msg_id = new_id("msg")
            conn.execute(
                """
                INSERT INTO messages
                  (id, party_id, table_id, sender_type, sender_id, kind, text, media_url,
                   duration_seconds, quote_message_id, quote_sender, quote_kind, quote_text,
                   quote_media_url, quote_duration_seconds, is_flash, flash_expires_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CASE WHEN ? = 1 THEN datetime('now', '+8 hours', ?) ELSE NULL END)
                """,
                (
                    msg_id,
                    party_id,
                    table_id,
                    sender_type,
                    sender_id,
                    kind,
                    body.get("text"),
                    body.get("mediaUrl"),
                    body.get("durationSeconds"),
                    body.get("quoteMessageId"),
                    body.get("quoteSender"),
                    body.get("quoteKind"),
                    body.get("quoteText"),
                    body.get("quoteMediaUrl"),
                    body.get("quoteDurationSeconds"),
                    1 if body.get("isFlash") else 0,
                    1 if body.get("isFlash") else 0,
                    f"+{int(body.get('flashSeconds') or 10)} seconds",
                ),
            )
            row = conn.execute("SELECT * FROM messages WHERE id = ?", (msg_id,)).fetchone()
            return {"ok": True, "message": self.decorate_message(conn, row)}

    def like_message(self, body: dict) -> dict:
        message_id = require(body, "messageId")
        with connect() as conn:
            row = conn.execute("SELECT * FROM messages WHERE id = ?", (message_id,)).fetchone()
            if not row:
                raise ApiError(404, "消息不存在")
            conn.execute("UPDATE messages SET like_count = like_count + 1 WHERE id = ?", (message_id,))
            updated = conn.execute("SELECT * FROM messages WHERE id = ?", (message_id,)).fetchone()
            return {"ok": True, "message": self.decorate_message(conn, updated)}

    def create_photo_burst(self, body: dict) -> dict:
        body["kind"] = "photo"
        body["text"] = body.get("text") or "照片"
        return self.create_message(body)

    def get_admin_tables(self, query: dict) -> dict:
        self.require_admin_request(query)
        party_id = require(query, "partyId")
        admin_id = query.get("adminId", "admin_mimei")
        with connect() as conn:
            party = self.load_party(conn, party_id)
            if not party or party["admin"]["id"] != admin_id:
                raise ApiError(403, "无管理员权限")
            table_rows = conn.execute(
                "SELECT * FROM party_tables WHERE party_id = ? ORDER BY table_no",
                (party_id,),
            ).fetchall()
            tables = [self.load_table_summary(conn, row) for row in table_rows]
            return {"ok": True, "party": party, "tables": tables}

    def get_table_invite(self, query: dict) -> dict:
        self.require_admin_request(query)
        table_id = require(query, "tableId")
        admin_id = query.get("adminId", "admin_mimei")
        with connect() as conn:
            table = conn.execute("SELECT * FROM party_tables WHERE id = ?", (table_id,)).fetchone()
            if not table:
                raise ApiError(404, "桌台不存在")
            party = self.load_party(conn, table["party_id"])
            if party["admin"]["id"] != admin_id:
                raise ApiError(403, "无管理员权限")
            scene = table["share_scene"]
            query_text = f"scene={scene}"
            link = ""
            if MINIPROGRAM_APPID and MINIPROGRAM_SECRET:
                link = self.generate_url_link(MINIPROGRAM_ROOM_PAGE, query_text)
            return {
                "ok": True,
                "partyId": table["party_id"],
                "tableId": table["id"],
                "tableNo": table["table_no"],
                "scene": scene,
                "path": MINIPROGRAM_ROOM_PAGE,
                "query": query_text,
                "urlLink": link,
                "adminPath": MINIPROGRAM_ADMIN_PAGE,
                "adminQuery": f"partyId={table['party_id']}",
                "qrcodeUrl": self.absolute_url(
                    f"/api/admin/tables/qrcode?tableId={table_id}&adminId={admin_id}"
                ),
            }

    def get_table_qrcode(self, query: dict) -> tuple[bytes, str]:
        self.require_admin_request(query)
        table_id = require(query, "tableId")
        admin_id = query.get("adminId", "admin_mimei")
        with connect() as conn:
            table = conn.execute("SELECT * FROM party_tables WHERE id = ?", (table_id,)).fetchone()
            if not table:
                raise ApiError(404, "桌台不存在")
            party = self.load_party(conn, table["party_id"])
            if party["admin"]["id"] != admin_id:
                raise ApiError(403, "无管理员权限")
        token = get_wechat_access_token()
        url = f"https://api.weixin.qq.com/wxa/getwxacodeunlimit?access_token={token}"
        return http_bytes(url, {
            "scene": table["share_scene"],
            "page": MINIPROGRAM_ROOM_PAGE,
            "check_path": False,
            "env_version": MINIPROGRAM_ENV_VERSION,
            "width": 430,
        })

    def generate_url_link(self, path: str, query: str) -> str:
        token = get_wechat_access_token()
        url = f"https://api.weixin.qq.com/wxa/generate_urllink?access_token={token}"
        result = http_json(url, {
            "path": path,
            "query": query,
            "is_expire": False,
            "env_version": MINIPROGRAM_ENV_VERSION,
        })
        return result.get("url_link", "")

    def absolute_url(self, path: str) -> str:
        if PUBLIC_API_BASE_URL:
            return f"{PUBLIC_API_BASE_URL.rstrip('/')}{path}"
        return path

    def update_admin_profile(self, body: dict) -> dict:
        self.require_admin_request(body)
        admin_id = body.get("adminId", "admin_mimei")
        wechat_id = require(body, "wechatId").strip()
        display_name = (body.get("displayName") or "").strip()
        if not wechat_id:
            raise ApiError(400, "管理员微信不能为空")
        with connect() as conn:
            admin = conn.execute("SELECT * FROM admins WHERE id = ?", (admin_id,)).fetchone()
            if not admin:
                raise ApiError(404, "管理员不存在")
            conn.execute(
                """
                UPDATE admins
                SET wechat_id = ?, display_name = COALESCE(NULLIF(?, ''), display_name)
                WHERE id = ?
                """,
                (wechat_id, display_name, admin_id),
            )
            updated = conn.execute("SELECT * FROM admins WHERE id = ?", (admin_id,)).fetchone()
            return {"ok": True, "admin": public_admin(updated)}

    def create_admin_party(self, body: dict) -> dict:
        self.require_admin_request(body)
        admin_id = body.get("adminId", "admin_mimei")
        title = require(body, "title").strip()
        table_no = (body.get("tableNo") or "A01").strip()
        capacity = int(body.get("capacity") or 8)
        bar_name = (body.get("barName") or "33 Party Lounge").strip()
        bar_address = require(body, "barAddress").strip()
        latitude = body.get("latitude")
        longitude = body.get("longitude")
        if not title:
            raise ApiError(400, "局名称不能为空")
        if capacity < 1 or capacity > 99:
            raise ApiError(400, "人数必须在 1-99 之间")
        if not table_no:
            raise ApiError(400, "桌号不能为空")
        if not bar_address:
            raise ApiError(400, "酒吧地址不能为空")

        with connect() as conn:
            admin = conn.execute("SELECT * FROM admins WHERE id = ?", (admin_id,)).fetchone()
            if not admin:
                raise ApiError(404, "管理员不存在")
            bar_id = new_id("bar")
            party_id = new_id("party")
            table_id = new_id("table")
            scene_code = f"party_{uuid.uuid4().hex[:8]}"
            share_scene = f"table_{uuid.uuid4().hex[:8]}"
            conn.execute(
                """
                INSERT INTO bars (id, name, address, latitude, longitude)
                VALUES (?, ?, ?, ?, ?)
                """,
                (bar_id, bar_name, bar_address, latitude, longitude),
            )
            conn.execute(
                """
                INSERT INTO parties (id, bar_id, admin_id, title, scene_code, starts_at)
                VALUES (?, ?, ?, ?, ?, datetime('now', '+8 hours'))
                """,
                (party_id, bar_id, admin_id, title, scene_code),
            )
            conn.execute(
                """
                INSERT INTO party_tables (id, party_id, table_no, capacity, share_scene)
                VALUES (?, ?, ?, ?, ?)
                """,
                (table_id, party_id, table_no, capacity, share_scene),
            )
            party = self.load_party(conn, party_id)
            table = conn.execute("SELECT * FROM party_tables WHERE id = ?", (table_id,)).fetchone()
            return {"ok": True, "party": party, "tables": [self.load_table_summary(conn, table)]}

    def set_member_seat_status(self, body: dict) -> dict:
        self.require_admin_request(body)
        member_id = require(body, "memberId")
        seat_status = body.get("seatStatus", "seated")
        if seat_status not in {"ghost", "seated"}:
            raise ApiError(400, "seatStatus 必须是 ghost 或 seated")
        with connect() as conn:
            row = conn.execute("SELECT * FROM party_members WHERE id = ?", (member_id,)).fetchone()
            if not row:
                raise ApiError(404, "成员不存在")
            conn.execute(
                "UPDATE party_members SET seat_status = ?, last_seen_at = datetime('now', '+8 hours') WHERE id = ?",
                (seat_status, member_id),
            )
            return {"ok": True, "memberId": member_id, "seatStatus": seat_status}

    def set_table_head(self, body: dict) -> dict:
        self.require_admin_request(body)
        table_id = require(body, "tableId")
        member_id = body.get("memberId") or None
        with connect() as conn:
            table = conn.execute("SELECT * FROM party_tables WHERE id = ?", (table_id,)).fetchone()
            if not table:
                raise ApiError(404, "桌台不存在")
            if member_id:
                member = conn.execute(
                    "SELECT * FROM party_members WHERE id = ? AND table_id = ?",
                    (member_id, table_id),
                ).fetchone()
                if not member:
                    raise ApiError(404, "成员不在当前桌")
                conn.execute(
                    "UPDATE party_members SET role = 'guest' WHERE table_id = ? AND role = 'head'",
                    (table_id,),
                )
                conn.execute("UPDATE party_members SET role = 'head' WHERE id = ?", (member_id,))
                conn.execute("UPDATE party_tables SET head_member_id = ? WHERE id = ?", (member_id, table_id))
            else:
                conn.execute(
                    "UPDATE party_members SET role = 'guest' WHERE table_id = ? AND role = 'head'",
                    (table_id,),
                )
                conn.execute("UPDATE party_tables SET head_member_id = NULL WHERE id = ?", (table_id,))
            updated = conn.execute("SELECT * FROM party_tables WHERE id = ?", (table_id,)).fetchone()
            return {"ok": True, "table": self.load_table_summary(conn, updated)}

    def kick_member(self, body: dict) -> dict:
        self.require_admin_request(body)
        member_id = require(body, "memberId")
        with connect() as conn:
            row = conn.execute("SELECT * FROM party_members WHERE id = ?", (member_id,)).fetchone()
            if not row:
                raise ApiError(404, "成员不存在")
            if row["role"] == "head":
                conn.execute("UPDATE party_tables SET head_member_id = NULL WHERE id = ?", (row["table_id"],))
            conn.execute("DELETE FROM party_members WHERE id = ?", (member_id,))
            conn.execute(
                """
                INSERT INTO messages (id, party_id, table_id, sender_type, sender_id, kind, text)
                VALUES (?, ?, ?, 'admin', ?, 'system', '管理员已移除一位未确认成员')
                """,
                (new_id("msg"), row["party_id"], row["table_id"], "admin_mimei"),
            )
            return {"ok": True, "memberId": member_id}

    def request_contact(self, body: dict) -> dict:
        party_id = require(body, "partyId")
        requester_type = require(body, "requesterType")
        requester_id = require(body, "requesterId")
        target_type = require(body, "targetType")
        target_id = require(body, "targetId")

        if {requester_type, target_type} != {"user", "admin"}:
            raise ApiError(403, "平台不允许用户之间互加微信")

        with connect() as conn:
            self.ensure_sender(conn, requester_type, requester_id)
            self.ensure_sender(conn, target_type, target_id)
            request_id = new_id("contact")
            conn.execute(
                """
                INSERT INTO contact_requests
                  (id, party_id, requester_type, requester_id, target_type, target_id, status)
                VALUES (?, ?, ?, ?, ?, ?, 'allowed')
                """,
                (request_id, party_id, requester_type, requester_id, target_type, target_id),
            )
            target = self.load_contact_target(conn, target_type, target_id)
            return {"ok": True, "requestId": request_id, "contact": target}

    def load_party(self, conn: sqlite3.Connection, party_id: str) -> dict:
        row = conn.execute(
            """
            SELECT p.*, b.name AS bar_name, b.address AS bar_address, b.latitude, b.longitude
            FROM parties p
            JOIN bars b ON b.id = p.bar_id
            WHERE p.id = ?
            """,
            (party_id,),
        ).fetchone()
        if not row:
            raise ApiError(404, "主局不存在")
        admin = conn.execute("SELECT * FROM admins WHERE id = ?", (row["admin_id"],)).fetchone()
        return {
            "id": row["id"],
            "title": row["title"],
            "sceneCode": row["scene_code"],
            "status": row["status"],
            "startsAt": row["starts_at"],
            "bar": {
                "id": row["bar_id"],
                "name": row["bar_name"],
                "address": row["bar_address"],
                "latitude": row["latitude"],
                "longitude": row["longitude"],
            },
            "admin": public_admin(admin),
        }

    def load_room(self, conn: sqlite3.Connection, party_id: str, table_id: str, viewer_user_id: str | None) -> dict:
        party = self.load_party(conn, party_id)
        table = conn.execute("SELECT * FROM party_tables WHERE id = ?", (table_id,)).fetchone()
        if not table:
            raise ApiError(404, "桌台不存在")
        members = conn.execute(
            """
            SELECT u.*, m.id AS member_id, m.role, m.seat_status, m.joined_at, m.last_seen_at
            FROM party_members m
            JOIN users u ON u.id = m.user_id
            WHERE m.party_id = ? AND m.table_id = ?
            ORDER BY m.joined_at ASC
            """,
            (party_id, table_id),
        ).fetchall()
        messages = conn.execute(
            """
            SELECT * FROM messages
            WHERE party_id = ? AND table_id = ?
            ORDER BY created_at DESC, id DESC
            LIMIT 50
            """,
            (party_id, table_id),
        ).fetchall()
        return {
            "party": party,
            "table": table_summary(table, len([m for m in members if m["seat_status"] == "seated"]), len(members)),
            "members": [public_user(row, expose_wechat=False) for row in members],
            "viewer": {"userId": viewer_user_id, "canSeeOtherUserWechat": False},
            "messages": [self.decorate_message(conn, row) for row in reversed(messages)],
        }

    def load_table_summary(self, conn: sqlite3.Connection, table: sqlite3.Row) -> dict:
        party = conn.execute("SELECT title FROM parties WHERE id = ?", (table["party_id"],)).fetchone()
        members = conn.execute(
            """
            SELECT u.*, m.id AS member_id, m.role, m.seat_status, m.joined_at, m.last_seen_at
            FROM party_members m
            JOIN users u ON u.id = m.user_id
            WHERE m.table_id = ?
            ORDER BY m.joined_at ASC
            """,
            (table["id"],),
        ).fetchall()
        recent = conn.execute(
            """
            SELECT * FROM messages
            WHERE table_id = ?
            ORDER BY created_at DESC, id DESC
            LIMIT 1
            """,
            (table["id"],),
        ).fetchone()
        photo_count = conn.execute(
            "SELECT COUNT(*) AS total FROM messages WHERE table_id = ? AND kind = 'photo'",
            (table["id"],),
        ).fetchone()["total"]
        seated_count = len([member for member in members if member["seat_status"] == "seated"])
        summary = table_summary(table, seated_count, len(members))
        summary["title"] = party["title"] if party else ""
        summary["members"] = [public_user(row, expose_wechat=True) for row in members]
        head = None
        if table["head_member_id"]:
            head = next((row for row in members if row["member_id"] == table["head_member_id"]), None)
        if not head:
            head = next((row for row in members if row["role"] == "head"), None)
        if head:
            summary["headMemberId"] = head["member_id"]
            summary["head"] = public_user(head, expose_wechat=True)
        else:
            summary["headMemberId"] = None
            summary["head"] = None
        summary["recentMessage"] = self.decorate_message(conn, recent) if recent else None
        summary["photoBurstCount"] = photo_count
        return summary

    def decorate_message(self, conn: sqlite3.Connection, row: sqlite3.Row | None) -> dict | None:
        if not row:
            return None
        sender = self.load_message_sender(conn, row)
        return {
            "id": row["id"],
            "partyId": row["party_id"],
            "tableId": row["table_id"],
            "senderType": row["sender_type"],
            "sender": sender,
            "kind": row["kind"],
            "text": row["text"],
            "mediaUrl": row["media_url"],
            "durationSeconds": row["duration_seconds"],
            "quote": {
                "id": row["quote_message_id"],
                "sender": row["quote_sender"],
                "type": row["quote_kind"],
                "text": row["quote_text"],
                "mediaUrl": row["quote_media_url"],
                "durationSeconds": row["quote_duration_seconds"],
            } if row["quote_message_id"] else None,
            "likeCount": row["like_count"],
            "isFlash": bool(row["is_flash"]),
            "flashExpiresAt": row["flash_expires_at"],
            "createdAt": row["created_at"],
        }

    def load_message_sender(self, conn: sqlite3.Connection, row: sqlite3.Row) -> dict:
        if row["sender_type"] == "user":
            user = conn.execute(
                """
                SELECT u.*, m.id AS member_id, m.role, m.seat_status, m.last_seen_at
                FROM users u
                LEFT JOIN party_members m
                  ON m.user_id = u.id
                 AND m.party_id = ?
                 AND m.table_id = ?
                WHERE u.id = ?
                """,
                (row["party_id"], row["table_id"], row["sender_id"]),
            ).fetchone()
            if not user:
                raise ApiError(404, "用户不存在")
            return public_user(user, expose_wechat=False)
        return self.load_contact_target(conn, row["sender_type"], row["sender_id"], expose_private=False)

    def ensure_sender(self, conn: sqlite3.Connection, sender_type: str, sender_id: str) -> None:
        if sender_type == "admin":
            row = conn.execute("SELECT id FROM admins WHERE id = ?", (sender_id,)).fetchone()
        elif sender_type == "user":
            row = conn.execute("SELECT id FROM users WHERE id = ?", (sender_id,)).fetchone()
        else:
            raise ApiError(400, "身份类型必须是 user 或 admin")
        if not row:
            raise ApiError(404, "联系人不存在")

    def touch_member(self, conn: sqlite3.Connection, party_id: str, table_id: str, user_id: str) -> None:
        conn.execute(
            """
            UPDATE party_members
            SET last_seen_at = datetime('now', '+8 hours')
            WHERE party_id = ? AND table_id = ? AND user_id = ?
            """,
            (party_id, table_id, user_id),
        )

    def load_contact_target(
        self,
        conn: sqlite3.Connection,
        target_type: str,
        target_id: str,
        expose_private: bool = True,
    ) -> dict:
        if target_type == "admin":
            admin = conn.execute("SELECT * FROM admins WHERE id = ?", (target_id,)).fetchone()
            if not admin:
                raise ApiError(404, "管理员不存在")
            return public_admin(admin, expose_wechat=expose_private)
        user = conn.execute("SELECT * FROM users WHERE id = ?", (target_id,)).fetchone()
        if not user:
            raise ApiError(404, "用户不存在")
        return public_user(user, expose_wechat=expose_private)

    def require_admin_request(self, data: dict) -> None:
        token = self.headers.get("X-Admin-Token") or data.get("adminToken") or ""
        if token and self.validate_admin_token(token):
            return
        if not ADMIN_API_KEY and not REQUIRE_ADMIN_AUTH:
            return
        if not ADMIN_API_KEY:
            raise ApiError(500, "服务端未配置 ADMIN_API_KEY")
        provided = self.headers.get("X-Admin-Key") or data.get("adminKey") or ""
        if provided != ADMIN_API_KEY:
            raise ApiError(401, "管理员密钥无效")

    def validate_admin_token(self, token: str) -> bool:
        with connect() as conn:
            row = conn.execute(
                "SELECT token FROM admin_sessions WHERE token = ? AND expires_at > ?",
                (token, int(time.time())),
            ).fetchone()
            return bool(row)


def require(data: dict, key: str) -> str:
    value = data.get(key)
    if value is None or value == "":
        raise ApiError(400, f"缺少参数: {key}")
    return str(value)


def public_admin(row: sqlite3.Row, expose_wechat: bool = True) -> dict:
    data = {
        "id": row["id"],
        "displayName": row["display_name"],
        "avatarUrl": row["avatar_url"],
        "role": "admin",
    }
    if expose_wechat:
        data["wechatId"] = row["wechat_id"]
        data["wechatQrUrl"] = row["wechat_qr_url"]
    return data


def public_user(row: sqlite3.Row, expose_wechat: bool = False) -> dict:
    last_seen_at = row["last_seen_at"] if "last_seen_at" in row.keys() else None
    data = {
        "id": row["id"],
        "nickname": row["nickname"],
        "avatarUrl": row["avatar_url"],
        "gender": row["gender"] if "gender" in row.keys() else "unknown",
        "profileComplete": bool(row["profile_complete"]),
        "role": row["role"] if "role" in row.keys() else "guest",
        "memberId": row["member_id"] if "member_id" in row.keys() else None,
        "seatStatus": row["seat_status"] if "seat_status" in row.keys() else "ghost",
        "lastSeenAt": last_seen_at,
        "online": is_recently_seen(last_seen_at),
    }
    if expose_wechat:
        data["wechatId"] = row["wechat_id"]
        data["phone"] = row["phone"]
    return data


def is_recently_seen(value: str | None) -> bool:
    if not value:
        return False
    try:
        seen_at = time.mktime(time.strptime(value, "%Y-%m-%d %H:%M:%S"))
    except ValueError:
        return False
    return time.time() - seen_at <= ONLINE_WINDOW_SECONDS


def table_summary(row: sqlite3.Row, seated_count: int, total_count: int) -> dict:
    open_seats = max(row["capacity"] - seated_count, 0)
    return {
        "id": row["id"],
        "partyId": row["party_id"],
        "tableNo": row["table_no"],
        "capacity": row["capacity"],
        "status": "full" if open_seats == 0 else "available",
        "statusText": "人数已满" if open_seats == 0 else "人数未满",
        "shareScene": row["share_scene"],
        "headMemberId": row["head_member_id"] if "head_member_id" in row.keys() else None,
        "memberCount": seated_count,
        "totalMemberCount": total_count,
        "ghostCount": max(total_count - seated_count, 0),
        "openSeats": open_seats,
    }


def main() -> int:
    init_db(seed=True)
    port = int(sys.argv[1]) if len(sys.argv) > 1 else DEFAULT_PORT
    httpd = ThreadingHTTPServer((DEFAULT_HOST, port), PartyHandler)
    print(f"33party backend listening on http://{DEFAULT_HOST}:{port}")
    print(f"SQLite database: {DB_PATH}")
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("\nserver stopped")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
