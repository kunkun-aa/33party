from __future__ import annotations

import base64
import hashlib
import json
import mimetypes
import os
import sqlite3
import struct
import sys
import time
import uuid
import cgi
import secrets
import threading
from datetime import datetime
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
UPLOAD_DIR = Path(os.environ.get("UPLOAD_DIR", ROOT / "uploads"))
MAX_UPLOAD_BYTES = int(os.environ.get("MAX_UPLOAD_BYTES", str(80 * 1024 * 1024)))
MESSAGE_RETENTION_HOURS = int(os.environ.get("MESSAGE_RETENTION_HOURS", "2"))
UPLOAD_RETENTION_HOURS = int(os.environ.get("UPLOAD_RETENTION_HOURS", str(MESSAGE_RETENTION_HOURS)))
CLEANUP_INTERVAL_SECONDS = int(os.environ.get("CLEANUP_INTERVAL_SECONDS", "900"))
MINIPROGRAM_APPID = os.environ.get("WECHAT_MINIPROGRAM_APPID", "")
MINIPROGRAM_SECRET = os.environ.get("WECHAT_MINIPROGRAM_SECRET", "")
MINIPROGRAM_ENV_VERSION = os.environ.get("WECHAT_MINIPROGRAM_ENV_VERSION", "release")
MINIPROGRAM_MESSAGE_TEMPLATE_ID = os.environ.get("WECHAT_MESSAGE_TEMPLATE_ID", "")
DISABLE_WECHAT_SUBSCRIBE_SEND = os.environ.get("DISABLE_WECHAT_SUBSCRIBE_SEND", "").lower() in {
    "1",
    "true",
    "yes",
}
REQUIRE_ADMIN_AUTH = os.environ.get("REQUIRE_ADMIN_AUTH", "1" if APP_ENV == "production" else "0").lower() in {
    "1",
    "true",
    "yes",
}
MINIPROGRAM_ROOM_PAGE = "frontend/pages/room/index"
MINIPROGRAM_ADMIN_PAGE = "frontend/pages/admin/index"
TOKEN_CACHE = {"access_token": "", "expires_at": 0}
ONLINE_WINDOW_SECONDS = int(os.environ.get("ONLINE_WINDOW_SECONDS", "300"))
CLEANUP_STATE = {"last_run": 0}
CLEANUP_LOCK = threading.Lock()
WEBSOCKET_GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11"
REPORT_REASONS = {"骚扰辱骂", "色情低俗", "诈骗引流", "广告刷屏", "侵犯隐私", "其他"}
REPORT_STATUSES = {"pending", "resolved", "rejected"}
USER_RESTRICTED_MESSAGE = "账号已被限制使用"
AGREEMENT_REQUIRED_MESSAGE = "请先同意用户协议并确认已满 18 周岁"


def room_channel_key(party_id: str, table_id: str) -> str:
    return f"{party_id}:{table_id}"


class WebSocketClient:
    def __init__(self, handler: "PartyHandler", party_id: str, table_id: str, user_id: str = ""):
        self.handler = handler
        self.party_id = party_id
        self.table_id = table_id
        self.user_id = user_id
        self.channel_key = room_channel_key(party_id, table_id)
        self.closed = False
        self.send_lock = threading.Lock()

    def send_json(self, payload: dict) -> bool:
        try:
            data = json.dumps(payload, ensure_ascii=False).encode("utf-8")
            self.send_frame(data, opcode=0x1)
            return True
        except OSError:
            self.closed = True
            return False

    def send_frame(self, payload: bytes = b"", opcode: int = 0x1) -> None:
        header = bytearray([0x80 | opcode])
        length = len(payload)
        if length < 126:
            header.append(length)
        elif length <= 0xFFFF:
            header.append(126)
            header.extend(struct.pack("!H", length))
        else:
            header.append(127)
            header.extend(struct.pack("!Q", length))
        with self.send_lock:
            self.handler.wfile.write(bytes(header) + payload)
            self.handler.wfile.flush()

    def close(self) -> None:
        if self.closed:
            return
        self.closed = True
        try:
            self.send_frame(b"", opcode=0x8)
        except OSError:
            pass


class RoomWebSocketHub:
    def __init__(self):
        self.lock = threading.Lock()
        self.clients_by_room: dict[str, set[WebSocketClient]] = {}

    def add(self, client: WebSocketClient) -> None:
        with self.lock:
            self.clients_by_room.setdefault(client.channel_key, set()).add(client)

    def remove(self, client: WebSocketClient) -> None:
        with self.lock:
            clients = self.clients_by_room.get(client.channel_key)
            if not clients:
                return
            clients.discard(client)
            if not clients:
                self.clients_by_room.pop(client.channel_key, None)

    def broadcast(self, channel_key: str, payload: dict) -> None:
        with self.lock:
            clients = list(self.clients_by_room.get(channel_key, set()))
        for client in clients:
            if not client.send_json(payload):
                self.remove(client)


ROOM_WS_HUB = RoomWebSocketHub()


def now_sql() -> str:
    return "datetime('now', '+8 hours')"


def conn_now_text() -> str:
    return datetime.utcfromtimestamp(time.time() + 8 * 60 * 60).strftime("%Y-%m-%d %H:%M:%S")


def normalize_datetime_text(value: str | None) -> str:
    text = (value or "").strip()
    if not text:
        return ""
    normalized = text.replace("T", " ").replace("/", "-")
    if normalized.endswith("Z"):
        normalized = normalized[:-1]
    normalized = normalized.split(".")[0]
    if len(normalized) == 16:
        normalized = f"{normalized}:00"
    for pattern in ("%Y-%m-%d %H:%M:%S", "%Y-%m-%d %H:%M"):
        try:
            return datetime.strptime(normalized, pattern).strftime("%Y-%m-%d %H:%M:%S")
        except ValueError:
            continue
    raise ApiError(400, "开始时间格式应为 YYYY-MM-DD HH:mm")


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
    if APP_ENV != "production" and not (MINIPROGRAM_APPID and MINIPROGRAM_SECRET):
        return f"dev_openid_{uuid.uuid5(uuid.NAMESPACE_URL, code).hex[:16]}"
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


def truncate_text(value: str, max_length: int = 20) -> str:
    text = (value or "").strip()
    if len(text) <= max_length:
        return text
    return f"{text[:max_length - 1]}…"


def send_message_subscription_jobs(jobs: list[dict]) -> None:
    if DISABLE_WECHAT_SUBSCRIBE_SEND or APP_ENV == "test":
        with connect() as conn:
            for job in jobs:
                conn.execute(
                    "UPDATE message_subscriptions SET last_notified_at = datetime('now', '+8 hours') WHERE id = ?",
                    (job["subscriptionId"],),
                )
        return

    token = ""
    for job in jobs:
        try:
            if not token:
                token = get_wechat_access_token()
            url = f"https://api.weixin.qq.com/cgi-bin/message/subscribe/send?access_token={token}"
            http_json(url, {
                "touser": job["openid"],
                "template_id": job["templateId"],
                "page": job["page"],
                "miniprogram_state": MINIPROGRAM_ENV_VERSION,
                "lang": "zh_CN",
                "data": job["data"],
            })
        except ApiError as exc:
            print(f"subscribe message failed for {job['subscriptionId']}: {exc.message}")
            if "43101" in exc.message:
                with connect() as conn:
                    conn.execute(
                        """
                        UPDATE message_subscriptions
                        SET enabled = 0, status = 'rejected', updated_at = datetime('now', '+8 hours')
                        WHERE id = ?
                        """,
                        (job["subscriptionId"],),
                    )
            continue
        with connect() as conn:
            conn.execute(
                "UPDATE message_subscriptions SET last_notified_at = datetime('now', '+8 hours') WHERE id = ?",
                (job["subscriptionId"],),
            )


def init_db(seed: bool = True) -> None:
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    with connect() as conn:
        conn.executescript((ROOT / "schema.sql").read_text(encoding="utf-8"))
        migrate_db(conn)
        if seed:
            seed_db(conn)
    maybe_cleanup_expired_content(force=True)


def add_column_if_missing(conn: sqlite3.Connection, table: str, column: str, definition: str) -> None:
    columns = {row["name"] for row in conn.execute(f"PRAGMA table_info({table})").fetchall()}
    if column not in columns:
        conn.execute(f"ALTER TABLE {table} ADD COLUMN {column} {definition}")


def migrate_db(conn: sqlite3.Connection) -> None:
    add_column_if_missing(conn, "admins", "openid", "TEXT")
    add_column_if_missing(conn, "users", "gender", "TEXT NOT NULL DEFAULT 'unknown'")
    add_column_if_missing(conn, "users", "agreement_accepted_at", "TEXT")
    add_column_if_missing(conn, "users", "age_confirmed_at", "TEXT")
    add_column_if_missing(conn, "users", "banned_at", "TEXT")
    add_column_if_missing(conn, "users", "ban_reason", "TEXT")
    add_column_if_missing(conn, "party_members", "seat_status", "TEXT NOT NULL DEFAULT 'ghost'")
    add_column_if_missing(conn, "party_tables", "head_member_id", "TEXT REFERENCES party_members(id) ON DELETE SET NULL")
    add_column_if_missing(conn, "party_tables", "ended_at", "TEXT")
    add_column_if_missing(conn, "messages", "like_count", "INTEGER NOT NULL DEFAULT 0")
    add_column_if_missing(conn, "messages", "is_flash", "INTEGER NOT NULL DEFAULT 0")
    add_column_if_missing(conn, "messages", "flash_expires_at", "TEXT")
    add_column_if_missing(conn, "messages", "quote_message_id", "TEXT")
    add_column_if_missing(conn, "messages", "quote_sender", "TEXT")
    add_column_if_missing(conn, "messages", "quote_kind", "TEXT")
    add_column_if_missing(conn, "messages", "quote_text", "TEXT")
    add_column_if_missing(conn, "messages", "quote_media_url", "TEXT")
    add_column_if_missing(conn, "messages", "quote_duration_seconds", "INTEGER")
    add_column_if_missing(conn, "messages", "deleted_at", "TEXT")
    add_column_if_missing(conn, "messages", "deleted_by", "TEXT")
    add_column_if_missing(conn, "messages", "delete_reason", "TEXT")
    migrate_messages_kind_constraints(conn)
    conn.execute("UPDATE users SET gender = 'female' WHERE id = 'user_demo_1' AND gender = 'unknown'")
    conn.execute("UPDATE users SET gender = 'male' WHERE id = 'user_demo_2' AND gender = 'unknown'")
    conn.execute("UPDATE users SET agreement_accepted_at = COALESCE(agreement_accepted_at, datetime('now', '+8 hours')) WHERE id LIKE 'user_demo_%'")
    conn.execute("UPDATE users SET age_confirmed_at = COALESCE(age_confirmed_at, datetime('now', '+8 hours')) WHERE id LIKE 'user_demo_%'")
    conn.execute("UPDATE party_members SET seat_status = 'seated' WHERE id = 'member_demo_1'")
    conn.execute("UPDATE messages SET kind = 'photo' WHERE kind = 'photo_burst'")
    conn.execute("UPDATE messages SET text = REPLACE(text, '爆照一下，', '') WHERE text LIKE '%爆照一下%'")
    conn.execute("CREATE UNIQUE INDEX IF NOT EXISTS idx_admins_openid ON admins(openid)")
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS message_subscriptions (
          id TEXT PRIMARY KEY,
          party_id TEXT NOT NULL REFERENCES parties(id),
          table_id TEXT NOT NULL REFERENCES party_tables(id),
          user_id TEXT NOT NULL REFERENCES users(id),
          template_id TEXT NOT NULL,
          status TEXT NOT NULL DEFAULT 'accepted' CHECK(status IN ('accepted', 'rejected')),
          enabled INTEGER NOT NULL DEFAULT 1,
          last_notified_at TEXT,
          created_at TEXT NOT NULL DEFAULT (datetime('now', '+8 hours')),
          updated_at TEXT NOT NULL DEFAULT (datetime('now', '+8 hours')),
          UNIQUE(party_id, table_id, user_id, template_id)
        )
        """
    )
    conn.execute("CREATE INDEX IF NOT EXISTS idx_message_subscriptions_room ON message_subscriptions(party_id, table_id)")
    conn.execute("CREATE INDEX IF NOT EXISTS idx_message_subscriptions_user ON message_subscriptions(user_id)")
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS reports (
          id TEXT PRIMARY KEY,
          party_id TEXT NOT NULL REFERENCES parties(id),
          table_id TEXT NOT NULL REFERENCES party_tables(id),
          reporter_type TEXT NOT NULL CHECK(reporter_type IN ('user', 'admin')),
          reporter_id TEXT NOT NULL,
          target_type TEXT NOT NULL CHECK(target_type IN ('message', 'user')),
          target_id TEXT NOT NULL,
          target_user_id TEXT,
          reason TEXT NOT NULL,
          detail TEXT,
          status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending', 'resolved', 'rejected')),
          created_at TEXT NOT NULL DEFAULT (datetime('now', '+8 hours')),
          handled_at TEXT,
          handled_by TEXT
        )
        """
    )
    conn.execute("CREATE INDEX IF NOT EXISTS idx_reports_party ON reports(party_id, status, created_at)")
    conn.execute("CREATE INDEX IF NOT EXISTS idx_reports_target ON reports(target_type, target_id)")


def migrate_messages_kind_constraints(conn: sqlite3.Connection) -> None:
    table_sql = conn.execute(
        "SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'messages'"
    ).fetchone()
    if not table_sql:
        return
    table_sql_text = table_sql["sql"] or ""
    if "'video'" in table_sql_text and "'emoji'" in table_sql_text and "deleted_at" in table_sql_text:
        return
    columns = {row["name"] for row in conn.execute("PRAGMA table_info(messages)").fetchall()}
    deleted_at_expr = "deleted_at" if "deleted_at" in columns else "NULL"
    deleted_by_expr = "deleted_by" if "deleted_by" in columns else "NULL"
    delete_reason_expr = "delete_reason" if "delete_reason" in columns else "NULL"
    conn.executescript(
        f"""
        ALTER TABLE messages RENAME TO messages_old;
        CREATE TABLE messages (
          id TEXT PRIMARY KEY,
          party_id TEXT NOT NULL REFERENCES parties(id),
          table_id TEXT NOT NULL REFERENCES party_tables(id),
          sender_type TEXT NOT NULL CHECK(sender_type IN ('user', 'admin')),
          sender_id TEXT NOT NULL,
          kind TEXT NOT NULL CHECK(kind IN ('text', 'voice', 'photo', 'video', 'emoji', 'system', 'photo_burst')),
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
          deleted_at TEXT,
          deleted_by TEXT,
          delete_reason TEXT,
          created_at TEXT NOT NULL DEFAULT (datetime('now', '+8 hours'))
        );
        INSERT INTO messages
          (id, party_id, table_id, sender_type, sender_id, kind, text, media_url,
           duration_seconds, quote_message_id, quote_sender, quote_kind, quote_text,
           quote_media_url, quote_duration_seconds, like_count, is_flash, flash_expires_at,
           deleted_at, deleted_by, delete_reason, created_at)
        SELECT
          id, party_id, table_id, sender_type, sender_id, kind, text, media_url,
          duration_seconds, quote_message_id, quote_sender, quote_kind, quote_text,
          quote_media_url, quote_duration_seconds, like_count, is_flash, flash_expires_at,
          {deleted_at_expr}, {deleted_by_expr}, {delete_reason_expr}, created_at
        FROM messages_old;
        DROP TABLE messages_old;
        CREATE INDEX IF NOT EXISTS idx_messages_room ON messages(party_id, table_id, id);
        """
    )


def maybe_cleanup_expired_content(force: bool = False) -> None:
    if MESSAGE_RETENTION_HOURS <= 0 and UPLOAD_RETENTION_HOURS <= 0:
        return
    now = time.time()
    if not force and now - CLEANUP_STATE["last_run"] < CLEANUP_INTERVAL_SECONDS:
        return
    if not CLEANUP_LOCK.acquire(blocking=False):
        return
    try:
        if force or now - CLEANUP_STATE["last_run"] >= CLEANUP_INTERVAL_SECONDS:
            cleanup_expired_content()
            CLEANUP_STATE["last_run"] = now
    finally:
        CLEANUP_LOCK.release()


def cleanup_expired_content() -> dict:
    deleted_messages = 0
    deleted_files = 0
    with connect() as conn:
        media_urls: list[str] = []
        if MESSAGE_RETENTION_HOURS > 0:
            rows = conn.execute(
                """
                SELECT media_url, quote_media_url FROM messages
                WHERE sender_type = 'user'
                  AND kind IN ('text', 'voice', 'photo', 'video', 'emoji', 'photo_burst')
                  AND created_at < datetime('now', '+8 hours', ?)
                """,
                (f"-{MESSAGE_RETENTION_HOURS} hours",),
            ).fetchall()
            for row in rows:
                media_urls.extend([row["media_url"], row["quote_media_url"]])
            cursor = conn.execute(
                """
                DELETE FROM messages
                WHERE sender_type = 'user'
                  AND kind IN ('text', 'voice', 'photo', 'video', 'emoji', 'photo_burst')
                  AND created_at < datetime('now', '+8 hours', ?)
                """,
                (f"-{MESSAGE_RETENTION_HOURS} hours",),
            )
            deleted_messages = cursor.rowcount if cursor.rowcount != -1 else 0
        active_urls = {
            row["media_url"]
            for row in conn.execute(
                "SELECT media_url FROM messages WHERE media_url IS NOT NULL AND media_url != ''"
            ).fetchall()
        }

    for media_url in media_urls:
        if media_url and media_url not in active_urls:
            deleted_files += 1 if delete_uploaded_media(media_url) else 0
    deleted_files += cleanup_orphan_uploads(active_urls)
    return {"messages": deleted_messages, "files": deleted_files}


def cleanup_orphan_uploads(active_urls: set[str]) -> int:
    if UPLOAD_RETENTION_HOURS <= 0 or not UPLOAD_DIR.exists():
        return 0
    cutoff = time.time() - UPLOAD_RETENTION_HOURS * 3600
    deleted = 0
    for file_path in UPLOAD_DIR.rglob("*"):
        if not file_path.is_file():
            continue
        if file_path.stat().st_mtime > cutoff:
            continue
        url_path = f"/uploads/{file_path.relative_to(UPLOAD_DIR).as_posix()}"
        if any(url_path in url for url in active_urls):
            continue
        try:
            file_path.unlink()
            deleted += 1
        except OSError:
            pass
    prune_empty_upload_dirs()
    return deleted


def delete_uploaded_media(media_url: str) -> bool:
    parsed = urlparse(media_url)
    if not parsed.path.startswith("/uploads/"):
        return False
    relative = parsed.path.removeprefix("/uploads/").strip("/")
    if not relative or ".." in Path(relative).parts:
        return False
    file_path = (UPLOAD_DIR / relative).resolve()
    upload_root = UPLOAD_DIR.resolve()
    if upload_root not in file_path.parents or not file_path.is_file():
        return False
    try:
        file_path.unlink()
        prune_empty_upload_dirs()
        return True
    except OSError:
        return False


def prune_empty_upload_dirs() -> None:
    if not UPLOAD_DIR.exists():
        return
    for directory in sorted((path for path in UPLOAD_DIR.rglob("*") if path.is_dir()), reverse=True):
        try:
            directory.rmdir()
        except OSError:
            pass


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
            "2026-01-01 20:00:00",
            "2026-01-01 20:00:00",
        ),
        (
            "user_demo_2",
            "openid_demo_2",
            "Kai",
            "https://dummyimage.com/160x160/35c2a1/101918&text=K",
            "male",
            "kai_live",
            1,
            "2026-01-01 20:00:00",
            "2026-01-01 20:00:00",
        ),
    ]
    conn.executemany(
        """
        INSERT INTO users
          (id, openid, nickname, avatar_url, gender, wechat_id, profile_complete,
           agreement_accepted_at, age_confirmed_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
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
        if self.is_websocket_request():
            self.handle_websocket()
            return
        self.handle_request("GET")

    def do_POST(self) -> None:
        self.handle_request("POST")

    def is_websocket_request(self) -> bool:
        return self.headers.get("Upgrade", "").lower() == "websocket"

    def handle_websocket(self) -> None:
        try:
            parsed = urlparse(self.path)
            path = parsed.path.rstrip("/") or "/"
            if path != "/ws/room":
                raise ApiError(404, "WebSocket 地址不存在")
            query = {key: values[-1] for key, values in parse_qs(parsed.query).items()}
            client = self.accept_room_websocket(query)
            ROOM_WS_HUB.add(client)
            try:
                client.send_json({
                    "type": "connected",
                    "partyId": client.party_id,
                    "tableId": client.table_id,
                })
                self.websocket_read_loop(client)
            finally:
                ROOM_WS_HUB.remove(client)
                client.closed = True
        except ApiError as exc:
            self.send_error(exc.status, exc.message)
        except Exception as exc:  # pragma: no cover - keeps local dev debuggable.
            self.send_error(500, str(exc))

    def accept_room_websocket(self, query: dict) -> WebSocketClient:
        party_id = require(query, "partyId")
        table_id = require(query, "tableId")
        user_id = query.get("userId", "")
        key = self.headers.get("Sec-WebSocket-Key", "")
        if not key:
            raise ApiError(400, "缺少 WebSocket Key")
        with connect() as conn:
            table = conn.execute(
                """
                SELECT t.id, t.status AS table_status, p.status AS party_status
                FROM party_tables t
                JOIN parties p ON p.id = t.party_id
                WHERE t.id = ? AND t.party_id = ?
                """,
                (table_id, party_id),
            ).fetchone()
            if not table:
                raise ApiError(404, "桌台不存在")
            if table["party_status"] == "ended" or table["table_status"] == "ended":
                raise ApiError(410, "该局已结束")
            if user_id:
                self.touch_member(conn, party_id, table_id, user_id)
        accept = base64.b64encode(hashlib.sha1((key + WEBSOCKET_GUID).encode("ascii")).digest()).decode("ascii")
        self.send_response(101, "Switching Protocols")
        self.send_header("Upgrade", "websocket")
        self.send_header("Connection", "Upgrade")
        self.send_header("Sec-WebSocket-Accept", accept)
        self.end_headers()
        return WebSocketClient(self, party_id, table_id, user_id)

    def websocket_read_loop(self, client: WebSocketClient) -> None:
        while not client.closed:
            frame = self.read_websocket_frame()
            if frame is None:
                break
            opcode, payload = frame
            if opcode == 0x8:
                client.close()
                break
            if opcode == 0x9:
                client.send_frame(payload, opcode=0xA)
            elif opcode == 0x1:
                self.handle_websocket_message(client, payload)

    def read_websocket_frame(self) -> tuple[int, bytes] | None:
        header = self.rfile.read(2)
        if len(header) < 2:
            return None
        first, second = header
        opcode = first & 0x0F
        masked = bool(second & 0x80)
        length = second & 0x7F
        if length == 126:
            raw = self.rfile.read(2)
            if len(raw) < 2:
                return None
            length = struct.unpack("!H", raw)[0]
        elif length == 127:
            raw = self.rfile.read(8)
            if len(raw) < 8:
                return None
            length = struct.unpack("!Q", raw)[0]
        mask = self.rfile.read(4) if masked else b""
        payload = self.rfile.read(length) if length else b""
        if len(payload) < length:
            return None
        if masked:
            payload = bytes(byte ^ mask[index % 4] for index, byte in enumerate(payload))
        return opcode, payload

    def handle_websocket_message(self, client: WebSocketClient, payload: bytes) -> None:
        try:
            message = json.loads(payload.decode("utf-8") or "{}")
        except json.JSONDecodeError:
            return
        if message.get("type") == "ping":
            if client.user_id:
                with connect() as conn:
                    self.touch_member(conn, client.party_id, client.table_id, client.user_id)
            client.send_json({"type": "pong", "serverTime": int(time.time())})

    def handle_request(self, method: str) -> None:
        try:
            maybe_cleanup_expired_content()
            parsed = urlparse(self.path)
            path = parsed.path.rstrip("/") or "/"
            query = {key: values[-1] for key, values in parse_qs(parsed.query).items()}
            if method == "GET" and path.startswith("/uploads/"):
                self.serve_upload(path)
                return
            body = self.read_request_body() if method == "POST" else {}

            if method == "GET" and path == "/health":
                self.respond({"ok": True, "service": "33party-backend"})
            elif method == "GET" and path == "/api/config":
                self.respond({
                    "ok": True,
                    "roomPage": MINIPROGRAM_ROOM_PAGE,
                    "adminPage": MINIPROGRAM_ADMIN_PAGE,
                    "envVersion": MINIPROGRAM_ENV_VERSION,
                    "messageTemplateId": MINIPROGRAM_MESSAGE_TEMPLATE_ID,
                    "subscribeMessageEnabled": bool(MINIPROGRAM_MESSAGE_TEMPLATE_ID),
                })
            elif method == "POST" and path == "/api/users/login":
                self.respond(self.user_login(body), status=201)
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
            elif method == "POST" and path == "/api/messages/subscribe":
                self.respond(self.save_message_subscription(body), status=201)
            elif method == "POST" and path == "/api/reports":
                self.respond(self.create_report(body), status=201)
            elif method == "POST" and path == "/api/uploads":
                self.respond(self.upload_media(body), status=201)
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
            elif method == "POST" and path == "/api/admin/parties/end":
                self.respond(self.end_admin_party(body))
            elif method == "POST" and path == "/api/admin/parties/delete":
                self.respond(self.delete_ended_parties(body))
            elif method == "POST" and path == "/api/admin/members/seat":
                self.respond(self.set_member_seat_status(body))
            elif method == "POST" and path == "/api/admin/tables/head":
                self.respond(self.set_table_head(body))
            elif method == "POST" and path == "/api/admin/members/kick":
                self.respond(self.kick_member(body))
            elif method == "GET" and path == "/api/admin/reports":
                self.respond(self.get_admin_reports(query))
            elif method == "POST" and path == "/api/admin/reports/resolve":
                self.respond(self.resolve_report(body))
            elif method == "POST" and path == "/api/admin/messages/delete":
                self.respond(self.delete_message(body))
            elif method == "POST" and path == "/api/admin/users/ban":
                self.respond(self.ban_user(body))
            elif method == "POST" and path == "/api/admin/users/unban":
                self.respond(self.unban_user(body))
            elif method == "POST" and path == "/api/admin/cleanup":
                self.respond(self.cleanup_content(body))
            elif method == "POST" and path == "/api/contact/request":
                self.respond(self.request_contact(body), status=201)
            else:
                raise ApiError(404, "接口不存在")
        except ApiError as exc:
            self.respond({"ok": False, "error": exc.message}, status=exc.status)
        except sqlite3.IntegrityError:
            self.respond({"ok": False, "error": "资料已存在，请刷新后重试"}, status=409)
        except Exception as exc:  # pragma: no cover - keeps local dev debuggable.
            self.respond({"ok": False, "error": str(exc)}, status=500)

    def read_request_body(self) -> dict:
        content_type = self.headers.get("Content-Type", "")
        if content_type.lower().startswith("multipart/form-data"):
            return self.read_multipart_body()
        return self.read_json_body()

    def read_json_body(self) -> dict:
        length = int(self.headers.get("Content-Length", "0"))
        if length == 0:
            return {}
        raw = self.rfile.read(length)
        try:
            return json.loads(raw.decode("utf-8"))
        except json.JSONDecodeError as exc:
            raise ApiError(400, f"JSON 格式错误: {exc}") from exc

    def read_multipart_body(self) -> dict:
        length = int(self.headers.get("Content-Length", "0"))
        if length <= 0:
            raise ApiError(400, "上传内容为空")
        if length > MAX_UPLOAD_BYTES:
            raise ApiError(413, "上传文件过大")
        form = cgi.FieldStorage(
            fp=self.rfile,
            headers=self.headers,
            environ={
                "REQUEST_METHOD": "POST",
                "CONTENT_TYPE": self.headers.get("Content-Type", ""),
                "CONTENT_LENGTH": str(length),
            },
        )
        body: dict = {}
        for key in form.keys():
            field = form[key]
            if isinstance(field, list):
                field = field[0]
            if field.filename:
                body[key] = {
                    "filename": field.filename,
                    "contentType": field.type or "application/octet-stream",
                    "data": field.file.read(),
                }
            else:
                body[key] = field.value
        return body

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

    def serve_upload(self, path: str) -> None:
        relative = path.removeprefix("/uploads/").strip("/")
        if not relative or ".." in Path(relative).parts:
            raise ApiError(404, "文件不存在")
        file_path = (UPLOAD_DIR / relative).resolve()
        upload_root = UPLOAD_DIR.resolve()
        if upload_root not in file_path.parents or not file_path.is_file():
            raise ApiError(404, "文件不存在")
        content_type = mimetypes.guess_type(str(file_path))[0] or "application/octet-stream"
        self.respond_bytes(file_path.read_bytes(), content_type)

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
            party = conn.execute("SELECT status FROM parties WHERE id = ?", (party_id,)).fetchone()
            if party and party["status"] == "ended":
                raise ApiError(410, "该局已结束")
            if table and table["status"] == "ended":
                raise ApiError(410, "该桌已结束")
            return {"ok": True, "party": self.load_party(conn, party_id), "defaultTableId": table_id}

    def user_login(self, body: dict) -> dict:
        code = require(body, "code")
        openid = code_to_openid(code)
        with connect() as conn:
            user = conn.execute("SELECT * FROM users WHERE openid = ?", (openid,)).fetchone()
            return {
                "ok": True,
                "openid": openid,
                "user": public_user(user) if user else None,
            }

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
        supplied_openid = body.get("openid")
        openid = supplied_openid or f"mock_{uuid.uuid4().hex[:10]}"
        nickname = body.get("nickname") or "新朋友"
        requested_user_id = body.get("id")
        user_id = requested_user_id or f"user_{uuid.uuid5(uuid.NAMESPACE_URL, openid).hex[:12]}"
        avatar_url = body.get("avatarUrl") or body.get("avatar_url")
        wechat_id = body.get("wechatId") or body.get("wechat_id")
        gender = body.get("gender") or "unknown"
        phone = body.get("phone")
        profile_complete = 1 if nickname and avatar_url else 0
        agreement_requested = bool(body.get("agreementAccepted"))
        age_requested = bool(body.get("ageConfirmed"))
        changed_room_keys: set[str] = set()

        with connect() as conn:
            conn.execute("BEGIN IMMEDIATE")
            existing_by_openid = conn.execute("SELECT * FROM users WHERE openid = ?", (openid,)).fetchone()
            existing_by_id = conn.execute("SELECT * FROM users WHERE id = ?", (user_id,)).fetchone()
            if existing_by_openid and existing_by_id and existing_by_openid["id"] != existing_by_id["id"]:
                existing = existing_by_openid
            elif existing_by_id and supplied_openid and existing_by_id["openid"] and existing_by_id["openid"] != supplied_openid:
                existing = None
                user_id = f"user_{uuid.uuid5(uuid.NAMESPACE_URL, openid).hex[:12]}"
                if conn.execute("SELECT 1 FROM users WHERE id = ?", (user_id,)).fetchone():
                    user_id = new_id("user")
            else:
                existing = existing_by_openid or existing_by_id
            if existing and not supplied_openid:
                openid = existing["openid"] or openid
            agreement_accepted_at = existing["agreement_accepted_at"] if existing else None
            age_confirmed_at = existing["age_confirmed_at"] if existing else None
            if agreement_requested and not agreement_accepted_at:
                agreement_accepted_at = conn.execute("SELECT datetime('now', '+8 hours') AS now").fetchone()["now"]
            if age_requested and not age_confirmed_at:
                age_confirmed_at = conn.execute("SELECT datetime('now', '+8 hours') AS now").fetchone()["now"]
            if not agreement_accepted_at or not age_confirmed_at:
                raise ApiError(400, AGREEMENT_REQUIRED_MESSAGE)
            if existing:
                user_id = existing["id"]
                conn.execute(
                    """
                    UPDATE users
                    SET openid = ?, nickname = ?, avatar_url = ?, gender = ?, phone = ?, wechat_id = ?,
                        profile_complete = ?, agreement_accepted_at = ?, age_confirmed_at = ?,
                        updated_at = datetime('now', '+8 hours')
                    WHERE id = ?
                    """,
                    (
                        openid,
                        nickname,
                        avatar_url,
                        gender,
                        phone,
                        wechat_id,
                        profile_complete,
                        agreement_accepted_at,
                        age_confirmed_at,
                        user_id,
                    ),
                )
            else:
                try:
                    conn.execute(
                        """
                        INSERT INTO users
                          (id, openid, nickname, avatar_url, gender, phone, wechat_id, profile_complete,
                           agreement_accepted_at, age_confirmed_at)
                        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                        """,
                        (
                            user_id,
                            openid,
                            nickname,
                            avatar_url,
                            gender,
                            phone,
                            wechat_id,
                            profile_complete,
                            agreement_accepted_at,
                            age_confirmed_at,
                        ),
                    )
                except sqlite3.IntegrityError:
                    existing = conn.execute(
                        """
                        SELECT * FROM users
                        WHERE id = ? OR openid = ?
                        ORDER BY CASE WHEN openid = ? THEN 0 ELSE 1 END
                        LIMIT 1
                        """,
                        (user_id, openid, openid),
                    ).fetchone()
                    if not existing:
                        raise
                    user_id = existing["id"]
                    conn.execute(
                        """
                        UPDATE users
                        SET openid = COALESCE(openid, ?), nickname = ?, avatar_url = ?, gender = ?, phone = ?, wechat_id = ?,
                            profile_complete = ?, agreement_accepted_at = ?, age_confirmed_at = ?,
                            updated_at = datetime('now', '+8 hours')
                        WHERE id = ?
                        """,
                        (
                            openid,
                            nickname,
                            avatar_url,
                            gender,
                            phone,
                            wechat_id,
                            profile_complete,
                            agreement_accepted_at,
                            age_confirmed_at,
                            user_id,
                        ),
                    )
            user = conn.execute("SELECT * FROM users WHERE id = ?", (user_id,)).fetchone()
            updated_user = public_user(user)
            changed_room_keys = {
                room_channel_key(row["party_id"], row["table_id"])
                for row in conn.execute(
                    """
                    SELECT party_id, table_id
                    FROM party_members
                    WHERE user_id = ?
                    """,
                    (user_id,),
                ).fetchall()
            }
        if changed_room_keys:
            for channel_key in changed_room_keys:
                ROOM_WS_HUB.broadcast(channel_key, {
                    "type": "user.profile.updated",
                    "user": updated_user,
                })
        return {"ok": True, "user": updated_user}

    def join_party(self, body: dict) -> dict:
        party_id = require(body, "partyId")
        user_id = require(body, "userId")
        table_id = body.get("tableId")

        with connect() as conn:
            party = conn.execute("SELECT * FROM parties WHERE id = ?", (party_id,)).fetchone()
            if not party:
                raise ApiError(404, "主局不存在")
            if party["status"] == "ended":
                raise ApiError(410, "该局已结束")
            user = conn.execute("SELECT * FROM users WHERE id = ?", (user_id,)).fetchone()
            if not user:
                raise ApiError(404, "用户不存在，请先完善资料")
            self.ensure_user_can_use(user)
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
            if table["status"] == "ended":
                raise ApiError(410, "该桌已结束")

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
            self.ensure_table_open(conn, party_id, table_id)
            if user_id:
                self.touch_member(conn, party_id, table_id, user_id)
            return {"ok": True, "room": self.load_room(conn, party_id, table_id, user_id)}

    def get_messages(self, query: dict) -> dict:
        party_id = require(query, "partyId")
        table_id = require(query, "tableId")
        after_id = query.get("afterId")
        params: list = [party_id, table_id]
        where = "party_id = ? AND table_id = ?"
        if MESSAGE_RETENTION_HOURS > 0:
            where += " AND (sender_type != 'user' OR kind = 'system' OR created_at >= datetime('now', '+8 hours', ?))"
            params.append(f"-{MESSAGE_RETENTION_HOURS} hours")
        if after_id:
            where += " AND id > ?"
            params.append(after_id)
        with connect() as conn:
            self.ensure_table_open(conn, party_id, table_id)
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
        if kind not in {"text", "voice", "photo", "video", "emoji", "system", "photo_burst"}:
            raise ApiError(400, "不支持的消息类型")

        with connect() as conn:
            self.ensure_table_open(conn, party_id, table_id)
            self.ensure_sender(conn, sender_type, sender_id)
            if sender_type == "user":
                user = conn.execute("SELECT * FROM users WHERE id = ?", (sender_id,)).fetchone()
                self.ensure_user_can_use(user)
                self.ensure_user_seated(conn, party_id, table_id, sender_id)
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
            message = self.decorate_message(conn, row)
            notification_jobs = self.build_message_subscription_jobs(conn, row, message)
        ROOM_WS_HUB.broadcast(room_channel_key(party_id, table_id), {
            "type": "message.created",
            "partyId": party_id,
            "tableId": table_id,
            "message": message,
        })
        self.dispatch_message_subscription_jobs(notification_jobs)
        return {"ok": True, "message": message}

    def build_message_subscription_jobs(self, conn: sqlite3.Connection, row: sqlite3.Row, message: dict) -> list[dict]:
        if not MINIPROGRAM_MESSAGE_TEMPLATE_ID or row["sender_type"] != "user" or row["kind"] == "system":
            return []
        party = self.load_party(conn, row["party_id"])
        table = conn.execute("SELECT table_no FROM party_tables WHERE id = ?", (row["table_id"],)).fetchone()
        sender = message.get("sender") or {}
        sender_name = sender.get("nickname") or sender.get("displayName") or "同桌成员"
        content = message.get("text") or {
            "voice": "发来一条语音消息",
            "photo": "发来一张照片",
            "video": "发来一段视频",
            "emoji": "发来一个表情",
            "photo_burst": "发来一张照片",
        }.get(row["kind"], "有一条新消息")
        page = f"{MINIPROGRAM_ROOM_PAGE}?partyId={row['party_id']}&tableId={row['table_id']}"
        data = {
            "thing1": {"value": truncate_text(party["title"] if party else "33party 房间")},
            "thing2": {"value": truncate_text(sender_name)},
            "thing3": {"value": truncate_text(content)},
            "thing4": {"value": truncate_text(table["table_no"] if table else "房间")},
        }
        subscriptions = conn.execute(
            """
            SELECT ms.*, u.openid
            FROM message_subscriptions ms
            JOIN users u ON u.id = ms.user_id
            WHERE ms.party_id = ? AND ms.table_id = ? AND ms.template_id = ?
              AND ms.status = 'accepted' AND ms.enabled = 1
              AND ms.user_id != ? AND u.openid IS NOT NULL AND u.openid != ''
            """,
            (row["party_id"], row["table_id"], MINIPROGRAM_MESSAGE_TEMPLATE_ID, row["sender_id"]),
        ).fetchall()
        return [
            {
                "subscriptionId": subscription["id"],
                "openid": subscription["openid"],
                "templateId": subscription["template_id"],
                "page": page,
                "data": data,
            }
            for subscription in subscriptions
        ]

    def dispatch_message_subscription_jobs(self, jobs: list[dict]) -> None:
        if not jobs:
            return
        thread = threading.Thread(
            target=send_message_subscription_jobs,
            args=(jobs,),
            name="message-subscription-send",
            daemon=True,
        )
        thread.start()

    def save_message_subscription(self, body: dict) -> dict:
        party_id = require(body, "partyId")
        table_id = require(body, "tableId")
        user_id = require(body, "userId")
        template_id = body.get("templateId") or MINIPROGRAM_MESSAGE_TEMPLATE_ID
        if not template_id:
            raise ApiError(400, "缺少订阅消息模板 ID")
        status = body.get("status") or "accepted"
        if status not in {"accepted", "rejected"}:
            raise ApiError(400, "订阅状态必须是 accepted 或 rejected")
        enabled = 1 if status == "accepted" and body.get("enabled", True) else 0
        with connect() as conn:
            table = conn.execute(
                "SELECT id FROM party_tables WHERE id = ? AND party_id = ?",
                (table_id, party_id),
            ).fetchone()
            if not table:
                raise ApiError(404, "桌台不存在")
            user = conn.execute("SELECT id, openid FROM users WHERE id = ?", (user_id,)).fetchone()
            if not user:
                raise ApiError(404, "用户不存在")
            if not user["openid"]:
                raise ApiError(400, "用户缺少 openid，无法接收微信订阅消息")
            existing = conn.execute(
                """
                SELECT id FROM message_subscriptions
                WHERE party_id = ? AND table_id = ? AND user_id = ? AND template_id = ?
                """,
                (party_id, table_id, user_id, template_id),
            ).fetchone()
            if existing:
                sub_id = existing["id"]
                conn.execute(
                    """
                    UPDATE message_subscriptions
                    SET status = ?, enabled = ?, updated_at = datetime('now', '+8 hours')
                    WHERE id = ?
                    """,
                    (status, enabled, sub_id),
                )
            else:
                sub_id = new_id("sub")
                conn.execute(
                    """
                    INSERT INTO message_subscriptions
                      (id, party_id, table_id, user_id, template_id, status, enabled)
                    VALUES (?, ?, ?, ?, ?, ?, ?)
                    """,
                    (sub_id, party_id, table_id, user_id, template_id, status, enabled),
                )
            subscription = conn.execute("SELECT * FROM message_subscriptions WHERE id = ?", (sub_id,)).fetchone()
            return {"ok": True, "subscription": row_to_dict(subscription)}

    def upload_media(self, body: dict) -> dict:
        file = body.get("file")
        if not isinstance(file, dict) or not file.get("data"):
            raise ApiError(400, "缺少上传文件")
        media_type = body.get("mediaType") or body.get("type") or "file"
        if media_type not in {"voice", "photo", "video", "emoji", "avatar", "file"}:
            raise ApiError(400, "不支持的上传类型")
        data = file["data"]
        if len(data) > MAX_UPLOAD_BYTES:
            raise ApiError(413, "上传文件过大")

        suffix = Path(file.get("filename") or "").suffix.lower()
        if not suffix:
            suffix = mimetypes.guess_extension(file.get("contentType") or "") or ".bin"
        allowed_suffixes = {
            "voice": {".aac", ".amr", ".mp3", ".m4a", ".wav"},
            "photo": {".jpg", ".jpeg", ".png", ".gif", ".webp", ".heic"},
            "emoji": {".jpg", ".jpeg", ".png", ".gif", ".webp"},
            "video": {".mp4", ".mov", ".m4v", ".avi"},
            "avatar": {".jpg", ".jpeg", ".png", ".webp", ".heic"},
            "file": {".aac", ".amr", ".mp3", ".m4a", ".wav", ".jpg", ".jpeg", ".png", ".gif", ".webp", ".heic", ".mp4", ".mov", ".m4v", ".avi"},
        }
        if suffix not in allowed_suffixes[media_type]:
            raise ApiError(400, "文件格式暂不支持")

        target_dir = UPLOAD_DIR / media_type
        target_dir.mkdir(parents=True, exist_ok=True)
        filename = f"{new_id('media')}{suffix}"
        target_path = target_dir / filename
        target_path.write_bytes(data)

        path = f"/uploads/{media_type}/{filename}"
        return {
            "ok": True,
            "mediaUrl": self.absolute_url(path),
            "path": path,
            "contentType": file.get("contentType") or mimetypes.guess_type(filename)[0] or "application/octet-stream",
            "size": len(data),
        }

    def like_message(self, body: dict) -> dict:
        message_id = require(body, "messageId")
        with connect() as conn:
            row = conn.execute("SELECT * FROM messages WHERE id = ?", (message_id,)).fetchone()
            if not row:
                raise ApiError(404, "消息不存在")
            conn.execute("UPDATE messages SET like_count = like_count + 1 WHERE id = ?", (message_id,))
            updated = conn.execute("SELECT * FROM messages WHERE id = ?", (message_id,)).fetchone()
            message = self.decorate_message(conn, updated)
            ROOM_WS_HUB.broadcast(room_channel_key(row["party_id"], row["table_id"]), {
                "type": "message.updated",
                "partyId": row["party_id"],
                "tableId": row["table_id"],
                "message": message,
            })
            return {"ok": True, "message": message}

    def create_photo_burst(self, body: dict) -> dict:
        body["kind"] = "photo"
        body["text"] = body.get("text") or "照片"
        return self.create_message(body)

    def create_report(self, body: dict) -> dict:
        party_id = require(body, "partyId")
        table_id = require(body, "tableId")
        reporter_type = body.get("reporterType", "user")
        reporter_id = require(body, "reporterId")
        target_type = require(body, "targetType")
        target_id = require(body, "targetId")
        reason = require(body, "reason")
        detail = (body.get("detail") or "").strip()
        if reporter_type not in {"user", "admin"}:
            raise ApiError(400, "举报人类型必须是 user 或 admin")
        if target_type not in {"message", "user"}:
            raise ApiError(400, "举报对象必须是 message 或 user")
        if reason not in REPORT_REASONS:
            raise ApiError(400, "举报原因不支持")

        with connect() as conn:
            table = conn.execute(
                "SELECT id FROM party_tables WHERE id = ? AND party_id = ?",
                (table_id, party_id),
            ).fetchone()
            if not table:
                raise ApiError(404, "桌台不存在")
            self.ensure_sender(conn, reporter_type, reporter_id)
            if reporter_type == "user":
                reporter = conn.execute("SELECT * FROM users WHERE id = ?", (reporter_id,)).fetchone()
                self.ensure_user_can_use(reporter)
            target_user_id = None
            if target_type == "message":
                message = conn.execute(
                    "SELECT * FROM messages WHERE id = ? AND party_id = ? AND table_id = ?",
                    (target_id, party_id, table_id),
                ).fetchone()
                if not message:
                    raise ApiError(404, "消息不存在")
                target_user_id = message["sender_id"] if message["sender_type"] == "user" else None
            else:
                user = conn.execute("SELECT * FROM users WHERE id = ?", (target_id,)).fetchone()
                if not user:
                    raise ApiError(404, "被举报用户不存在")
                target_user_id = user["id"]
            report_id = new_id("report")
            conn.execute(
                """
                INSERT INTO reports
                  (id, party_id, table_id, reporter_type, reporter_id, target_type,
                   target_id, target_user_id, reason, detail)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    report_id,
                    party_id,
                    table_id,
                    reporter_type,
                    reporter_id,
                    target_type,
                    target_id,
                    target_user_id,
                    reason,
                    detail,
                ),
            )
            row = conn.execute("SELECT * FROM reports WHERE id = ?", (report_id,)).fetchone()
            return {"ok": True, "report": self.decorate_report(conn, row)}

    def get_admin_reports(self, query: dict) -> dict:
        self.require_admin_request(query)
        party_id = require(query, "partyId")
        admin_id = query.get("adminId", "admin_mimei")
        status = query.get("status", "pending")
        if status not in REPORT_STATUSES:
            raise ApiError(400, "举报状态不支持")
        with connect() as conn:
            self.ensure_admin_party(conn, party_id, admin_id)
            rows = conn.execute(
                """
                SELECT * FROM reports
                WHERE party_id = ? AND status = ?
                ORDER BY created_at DESC, id DESC
                LIMIT 100
                """,
                (party_id, status),
            ).fetchall()
            return {"ok": True, "reports": [self.decorate_report(conn, row) for row in rows]}

    def resolve_report(self, body: dict) -> dict:
        self.require_admin_request(body)
        report_id = require(body, "reportId")
        status = require(body, "status")
        admin_id = body.get("adminId", "admin_mimei")
        if status not in {"resolved", "rejected"}:
            raise ApiError(400, "处理状态必须是 resolved 或 rejected")
        with connect() as conn:
            report = conn.execute("SELECT * FROM reports WHERE id = ?", (report_id,)).fetchone()
            if not report:
                raise ApiError(404, "举报不存在")
            self.ensure_admin_party(conn, report["party_id"], admin_id)
            conn.execute(
                """
                UPDATE reports
                SET status = ?, handled_at = datetime('now', '+8 hours'), handled_by = ?
                WHERE id = ?
                """,
                (status, admin_id, report_id),
            )
            updated = conn.execute("SELECT * FROM reports WHERE id = ?", (report_id,)).fetchone()
            return {"ok": True, "report": self.decorate_report(conn, updated)}

    def delete_message(self, body: dict) -> dict:
        self.require_admin_request(body)
        message_id = require(body, "messageId")
        admin_id = body.get("adminId", "admin_mimei")
        reason = (body.get("reason") or "违规内容").strip() or "违规内容"
        with connect() as conn:
            row = conn.execute("SELECT * FROM messages WHERE id = ?", (message_id,)).fetchone()
            if not row:
                raise ApiError(404, "消息不存在")
            self.ensure_admin_party(conn, row["party_id"], admin_id)
            conn.execute(
                """
                UPDATE messages
                SET deleted_at = COALESCE(deleted_at, datetime('now', '+8 hours')),
                    deleted_by = ?,
                    delete_reason = ?
                WHERE id = ?
                """,
                (admin_id, reason, message_id),
            )
            updated = conn.execute("SELECT * FROM messages WHERE id = ?", (message_id,)).fetchone()
            message = self.decorate_message(conn, updated)
        ROOM_WS_HUB.broadcast(room_channel_key(message["partyId"], message["tableId"]), {
            "type": "message.updated",
            "partyId": message["partyId"],
            "tableId": message["tableId"],
            "message": message,
        })
        return {"ok": True, "message": message}

    def ban_user(self, body: dict) -> dict:
        self.require_admin_request(body)
        user_id = require(body, "userId")
        admin_id = body.get("adminId", "admin_mimei")
        party_id = body.get("partyId")
        reason = (body.get("reason") or "违规使用").strip() or "违规使用"
        with connect() as conn:
            user = conn.execute("SELECT * FROM users WHERE id = ?", (user_id,)).fetchone()
            if not user:
                raise ApiError(404, "用户不存在")
            if party_id:
                self.ensure_admin_party(conn, party_id, admin_id)
            else:
                self.ensure_admin_exists(conn, admin_id)
            conn.execute(
                """
                UPDATE users
                SET banned_at = COALESCE(banned_at, datetime('now', '+8 hours')),
                    ban_reason = ?,
                    updated_at = datetime('now', '+8 hours')
                WHERE id = ?
                """,
                (reason, user_id),
            )
            updated = conn.execute("SELECT * FROM users WHERE id = ?", (user_id,)).fetchone()
            return {"ok": True, "user": public_user(updated, expose_wechat=True)}

    def unban_user(self, body: dict) -> dict:
        self.require_admin_request(body)
        user_id = require(body, "userId")
        admin_id = body.get("adminId", "admin_mimei")
        party_id = body.get("partyId")
        with connect() as conn:
            user = conn.execute("SELECT * FROM users WHERE id = ?", (user_id,)).fetchone()
            if not user:
                raise ApiError(404, "用户不存在")
            if party_id:
                self.ensure_admin_party(conn, party_id, admin_id)
            else:
                self.ensure_admin_exists(conn, admin_id)
            conn.execute(
                """
                UPDATE users
                SET banned_at = NULL, ban_reason = NULL, updated_at = datetime('now', '+8 hours')
                WHERE id = ?
                """,
                (user_id,),
            )
            updated = conn.execute("SELECT * FROM users WHERE id = ?", (user_id,)).fetchone()
            return {"ok": True, "user": public_user(updated, expose_wechat=True)}

    def decorate_report(self, conn: sqlite3.Connection, row: sqlite3.Row) -> dict:
        data = row_to_dict(row)
        data["partyId"] = data.pop("party_id")
        data["tableId"] = data.pop("table_id")
        data["reporterType"] = data.pop("reporter_type")
        data["reporterId"] = data.pop("reporter_id")
        data["targetType"] = data.pop("target_type")
        data["targetId"] = data.pop("target_id")
        data["targetUserId"] = data.pop("target_user_id")
        data["createdAt"] = data.pop("created_at")
        data["handledAt"] = data.pop("handled_at")
        data["handledBy"] = data.pop("handled_by")
        table = conn.execute("SELECT table_no FROM party_tables WHERE id = ?", (data["tableId"],)).fetchone()
        data["tableNo"] = table["table_no"] if table else ""
        try:
            data["reporter"] = self.load_contact_target(conn, data["reporterType"], data["reporterId"], expose_private=False)
        except ApiError:
            data["reporter"] = None
        data["targetUser"] = None
        data["targetMemberId"] = None
        if data["targetUserId"]:
            target = conn.execute("SELECT * FROM users WHERE id = ?", (data["targetUserId"],)).fetchone()
            data["targetUser"] = public_user(target, expose_wechat=True) if target else None
            member = conn.execute(
                """
                SELECT id FROM party_members
                WHERE party_id = ? AND table_id = ? AND user_id = ?
                """,
                (data["partyId"], data["tableId"], data["targetUserId"]),
            ).fetchone()
            data["targetMemberId"] = member["id"] if member else None
        data["targetMessage"] = None
        if data["targetType"] == "message":
            message = conn.execute("SELECT * FROM messages WHERE id = ?", (data["targetId"],)).fetchone()
            data["targetMessage"] = self.decorate_message(conn, message) if message else None
        return data

    def cleanup_content(self, body: dict) -> dict:
        self.require_admin_request(body)
        result = cleanup_expired_content()
        CLEANUP_STATE["last_run"] = time.time()
        return {
            "ok": True,
            "retentionHours": MESSAGE_RETENTION_HOURS,
            "uploadRetentionHours": UPLOAD_RETENTION_HOURS,
            "deleted": result,
        }

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
        host = self.headers.get("Host", "")
        if host:
            proto = self.headers.get("X-Forwarded-Proto") or ("http" if host.startswith(("127.0.0.1", "localhost")) else "https")
            return f"{proto}://{host}{path}"
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
        starts_at = normalize_datetime_text(body.get("startsAt")) or conn_now_text()
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
                VALUES (?, ?, ?, ?, ?, ?)
                """,
                (party_id, bar_id, admin_id, title, scene_code, starts_at),
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

    def end_admin_party(self, body: dict) -> dict:
        self.require_admin_request(body)
        admin_id = body.get("adminId", "admin_mimei")
        party_id = require(body, "partyId")
        ended_channels: list[str] = []
        with connect() as conn:
            self.ensure_admin_party(conn, party_id, admin_id)
            table_rows = conn.execute("SELECT id FROM party_tables WHERE party_id = ?", (party_id,)).fetchall()
            ended_channels = [room_channel_key(party_id, row["id"]) for row in table_rows]
            conn.execute(
                """
                UPDATE parties
                SET status = 'ended'
                WHERE id = ?
                """,
                (party_id,),
            )
            conn.execute(
                """
                UPDATE party_tables
                SET status = 'ended', ended_at = COALESCE(ended_at, datetime('now', '+8 hours'))
                WHERE party_id = ?
                """,
                (party_id,),
            )
            party = self.load_party(conn, party_id)
            tables = [self.load_table_summary(conn, row) for row in conn.execute(
                "SELECT * FROM party_tables WHERE party_id = ? ORDER BY table_no",
                (party_id,),
            ).fetchall()]
        for channel_key in ended_channels:
            ROOM_WS_HUB.broadcast(channel_key, {
                "type": "party.ended",
                "partyId": party_id,
            })
        return {"ok": True, "party": party, "tables": tables}

    def delete_ended_parties(self, body: dict) -> dict:
        self.require_admin_request(body)
        admin_id = body.get("adminId", "admin_mimei")
        party_ids = body.get("partyIds") or []
        if isinstance(party_ids, str):
            party_ids = [party_ids]
        party_ids = [str(party_id) for party_id in party_ids if party_id]
        if not party_ids:
            raise ApiError(400, "请选择要删除的局")
        deleted: list[str] = []
        with connect() as conn:
            for party_id in party_ids:
                self.ensure_admin_party(conn, party_id, admin_id)
                party = conn.execute("SELECT status FROM parties WHERE id = ?", (party_id,)).fetchone()
                if not party:
                    raise ApiError(404, "主局不存在")
                if party["status"] != "ended":
                    raise ApiError(400, "只能删除已结束的局")
            for party_id in party_ids:
                table_ids = [row["id"] for row in conn.execute(
                    "SELECT id FROM party_tables WHERE party_id = ?",
                    (party_id,),
                ).fetchall()]
                if table_ids:
                    placeholders = ",".join("?" for _ in table_ids)
                    conn.execute(f"DELETE FROM message_subscriptions WHERE table_id IN ({placeholders})", table_ids)
                    conn.execute(f"DELETE FROM reports WHERE table_id IN ({placeholders})", table_ids)
                    conn.execute(f"DELETE FROM messages WHERE table_id IN ({placeholders})", table_ids)
                    conn.execute(f"DELETE FROM party_members WHERE table_id IN ({placeholders})", table_ids)
                    conn.execute(f"DELETE FROM party_tables WHERE id IN ({placeholders})", table_ids)
                conn.execute("DELETE FROM contact_requests WHERE party_id = ?", (party_id,))
                conn.execute("DELETE FROM parties WHERE id = ?", (party_id,))
                deleted.append(party_id)
        return {"ok": True, "deletedPartyIds": deleted}

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
            updated = conn.execute(
                """
                SELECT u.*, m.id AS member_id, m.role, m.seat_status, m.joined_at, m.last_seen_at
                FROM party_members m
                JOIN users u ON u.id = m.user_id
                WHERE m.id = ?
                """,
                (member_id,),
            ).fetchone()
            table = conn.execute("SELECT * FROM party_tables WHERE id = ?", (row["table_id"],)).fetchone()
            member = public_user(updated, expose_wechat=False)
            table_data = self.load_table_summary(conn, table) if table else None
        ROOM_WS_HUB.broadcast(room_channel_key(row["party_id"], row["table_id"]), {
            "type": "member.updated",
            "partyId": row["party_id"],
            "tableId": row["table_id"],
            "member": member,
            "table": table_data,
        })
        return {
            "ok": True,
            "memberId": member_id,
            "seatStatus": seat_status,
            "member": member,
            "table": table_data,
        }

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
            ORDER BY CASE WHEN m.seat_status = 'seated' THEN 0 ELSE 1 END, m.joined_at ASC
            """,
            (party_id, table_id),
        ).fetchall()
        message_where = "party_id = ? AND table_id = ?"
        message_params: list = [party_id, table_id]
        if MESSAGE_RETENTION_HOURS > 0:
            message_where += " AND (sender_type != 'user' OR kind = 'system' OR created_at >= datetime('now', '+8 hours', ?))"
            message_params.append(f"-{MESSAGE_RETENTION_HOURS} hours")
        messages = conn.execute(
            f"""
            SELECT * FROM messages
            WHERE {message_where}
            ORDER BY created_at DESC, id DESC
            LIMIT 50
            """,
            message_params,
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
            ORDER BY CASE WHEN m.seat_status = 'seated' THEN 0 ELSE 1 END, m.joined_at ASC
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
        is_deleted = bool(row["deleted_at"] if "deleted_at" in row.keys() else None)
        return {
            "id": row["id"],
            "partyId": row["party_id"],
            "tableId": row["table_id"],
            "senderType": row["sender_type"],
            "sender": sender,
            "kind": row["kind"],
            "text": "该消息已被管理员删除" if is_deleted else row["text"],
            "mediaUrl": None if is_deleted else row["media_url"],
            "durationSeconds": None if is_deleted else row["duration_seconds"],
            "quote": None if is_deleted else ({
                "id": row["quote_message_id"],
                "sender": row["quote_sender"],
                "type": row["quote_kind"],
                "text": row["quote_text"],
                "mediaUrl": row["quote_media_url"],
                "durationSeconds": row["quote_duration_seconds"],
            } if row["quote_message_id"] else None),
            "likeCount": row["like_count"],
            "isFlash": bool(row["is_flash"]),
            "flashExpiresAt": row["flash_expires_at"],
            "isDeleted": is_deleted,
            "deletedAt": row["deleted_at"] if "deleted_at" in row.keys() else None,
            "deletedBy": row["deleted_by"] if "deleted_by" in row.keys() else None,
            "deleteReason": row["delete_reason"] if "delete_reason" in row.keys() else None,
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

    def ensure_user_can_use(self, user: sqlite3.Row | None) -> None:
        if not user:
            raise ApiError(404, "用户不存在")
        if user["banned_at"]:
            raise ApiError(403, USER_RESTRICTED_MESSAGE)
        if not user["agreement_accepted_at"] or not user["age_confirmed_at"]:
            raise ApiError(403, AGREEMENT_REQUIRED_MESSAGE)

    def ensure_user_seated(self, conn: sqlite3.Connection, party_id: str, table_id: str, user_id: str) -> None:
        member = conn.execute(
            """
            SELECT seat_status FROM party_members
            WHERE party_id = ? AND table_id = ? AND user_id = ?
            """,
            (party_id, table_id, user_id),
        ).fetchone()
        if not member:
            raise ApiError(403, "请先加入本桌并完成占位后再发言")
        if member["seat_status"] != "seated":
            raise ApiError(403, "未占位成员暂不能发言")

    def ensure_table_open(self, conn: sqlite3.Connection, party_id: str, table_id: str) -> None:
        row = conn.execute(
            """
            SELECT p.status AS party_status, t.status AS table_status
            FROM party_tables t
            JOIN parties p ON p.id = t.party_id
            WHERE p.id = ? AND t.id = ?
            """,
            (party_id, table_id),
        ).fetchone()
        if not row:
            raise ApiError(404, "桌台不存在")
        if row["party_status"] == "ended" or row["table_status"] == "ended":
            raise ApiError(410, "该局已结束")

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

    def ensure_admin_exists(self, conn: sqlite3.Connection, admin_id: str) -> None:
        admin = conn.execute("SELECT id FROM admins WHERE id = ?", (admin_id,)).fetchone()
        if not admin:
            raise ApiError(404, "管理员不存在")

    def ensure_admin_party(self, conn: sqlite3.Connection, party_id: str, admin_id: str) -> dict:
        party = self.load_party(conn, party_id)
        if not party or party["admin"]["id"] != admin_id:
            raise ApiError(403, "无管理员权限")
        return party

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
        "agreementAcceptedAt": row["agreement_accepted_at"] if "agreement_accepted_at" in row.keys() else None,
        "ageConfirmedAt": row["age_confirmed_at"] if "age_confirmed_at" in row.keys() else None,
        "bannedAt": row["banned_at"] if "banned_at" in row.keys() else None,
        "banReason": row["ban_reason"] if "ban_reason" in row.keys() else None,
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
    is_ended = row["status"] == "ended"
    return {
        "id": row["id"],
        "partyId": row["party_id"],
        "tableNo": row["table_no"],
        "capacity": row["capacity"],
        "status": "ended" if is_ended else ("full" if open_seats == 0 else "available"),
        "statusText": "已结束" if is_ended else ("人数已满" if open_seats == 0 else "人数未满"),
        "shareScene": row["share_scene"],
        "headMemberId": row["head_member_id"] if "head_member_id" in row.keys() else None,
        "endedAt": row["ended_at"] if "ended_at" in row.keys() else None,
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
