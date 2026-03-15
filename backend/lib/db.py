from __future__ import annotations

import asyncio
import json
import uuid
from datetime import datetime, timezone
from typing import Any

from loguru import logger

from .config import DB_TYPE, DB_PATH, DATABASE_URL

# ── Connection abstraction ──────────────────────────────────────────

_pool = None  # asyncpg pool or aiosqlite connection
_pool_lock = asyncio.Lock()
_is_pg = DB_TYPE == "postgres"


def _now() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M:%S")


def _new_id() -> str:
    return uuid.uuid4().hex[:16]


def _ph(n: int) -> str:
    """Placeholder: ? for SQLite, $N for Postgres."""
    if _is_pg:
        return ", ".join(f"${i}" for i in range(1, n + 1))
    return ", ".join("?" for _ in range(n))


def _p(idx: int) -> str:
    """Single placeholder."""
    return f"${idx}" if _is_pg else "?"


async def get_db():
    global _pool
    if _pool is not None:
        return _pool

    async with _pool_lock:
        if _pool is not None:
            return _pool

        if _is_pg:
            import asyncpg
            _pool = await asyncpg.create_pool(DATABASE_URL, min_size=2, max_size=10)
            async with _pool.acquire() as conn:
                await _init_pg(conn)
            logger.info("PostgreSQL pool initialized")
        else:
            import aiosqlite
            _pool = await aiosqlite.connect(DB_PATH)
            _pool.row_factory = aiosqlite.Row
            await _pool.execute("PRAGMA journal_mode=WAL")
            await _pool.execute("PRAGMA foreign_keys=ON")
            await _pool.executescript(_SQLITE_SCHEMA)
            await _run_sqlite_migrations(_pool)
            await _pool.commit()
            logger.info(f"SQLite initialized at {DB_PATH}")

    return _pool


async def close_db() -> None:
    global _pool
    if _pool is None:
        return
    if _is_pg:
        await _pool.close()
    else:
        await _pool.close()
    _pool = None


async def _exec(sql: str, params: tuple | list = (), *, fetch: bool = False, fetchone: bool = False, execute: bool = False):
    """Unified query executor for both backends."""
    db = await get_db()

    if _is_pg:
        async with db.acquire() as conn:
            if fetch:
                rows = await conn.fetch(sql, *params)
                return [dict(r) for r in rows]
            elif fetchone:
                row = await conn.fetchrow(sql, *params)
                return dict(row) if row else None
            else:
                result = await conn.execute(sql, *params)
                return result
    else:
        if fetch:
            rows = await db.execute_fetchall(sql, tuple(params))
            return [dict(r) for r in rows]
        elif fetchone:
            rows = await db.execute_fetchall(sql, tuple(params))
            return dict(rows[0]) if rows else None
        else:
            cur = await db.execute(sql, tuple(params))
            await db.commit()
            return cur


# ── Schema ──────────────────────────────────────────────────────────

_SQLITE_SCHEMA = """
CREATE TABLE IF NOT EXISTS topics (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    platforms TEXT NOT NULL,
    max_creators INTEGER NOT NULL DEFAULT 10,
    max_videos_per_creator INTEGER NOT NULL DEFAULT 0,
    status TEXT DEFAULT 'idle',
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS creators (
    id TEXT PRIMARY KEY,
    platform TEXT NOT NULL,
    platform_uid TEXT NOT NULL,
    name TEXT NOT NULL,
    avatar_url TEXT,
    follower_count INTEGER,
    video_count INTEGER DEFAULT 0,
    topic_id TEXT NOT NULL REFERENCES topics(id) ON DELETE CASCADE,
    UNIQUE(platform, platform_uid, topic_id)
);
CREATE TABLE IF NOT EXISTS videos (
    id TEXT PRIMARY KEY,
    platform TEXT NOT NULL,
    platform_video_id TEXT NOT NULL,
    title TEXT NOT NULL,
    description TEXT,
    thumbnail_url TEXT,
    duration INTEGER DEFAULT 0,
    view_count INTEGER,
    like_count INTEGER,
    published_at TEXT,
    creator_id TEXT REFERENCES creators(id),
    creator_name TEXT,
    topic_id TEXT NOT NULL REFERENCES topics(id) ON DELETE CASCADE,
    has_transcript INTEGER DEFAULT 0,
    transcript_source TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    UNIQUE(platform, platform_video_id, topic_id)
);
CREATE TABLE IF NOT EXISTS transcripts (
    id TEXT PRIMARY KEY,
    video_id TEXT NOT NULL REFERENCES videos(id) ON DELETE CASCADE,
    source TEXT NOT NULL,
    language TEXT DEFAULT 'zh',
    segments TEXT NOT NULL,
    full_text TEXT NOT NULL,
    created_at TEXT DEFAULT (datetime('now')),
    UNIQUE(video_id)
);
CREATE VIRTUAL TABLE IF NOT EXISTS transcripts_fts USING fts5(
    full_text, video_id UNINDEXED, content='transcripts', content_rowid='rowid'
);
CREATE TRIGGER IF NOT EXISTS transcripts_ai AFTER INSERT ON transcripts BEGIN
    INSERT INTO transcripts_fts(rowid, full_text, video_id)
    VALUES (new.rowid, new.full_text, new.video_id);
END;
CREATE TRIGGER IF NOT EXISTS transcripts_ad AFTER DELETE ON transcripts BEGIN
    INSERT INTO transcripts_fts(transcripts_fts, rowid, full_text, video_id)
    VALUES ('delete', old.rowid, old.full_text, old.video_id);
END;
CREATE TABLE IF NOT EXISTS tasks (
    id TEXT PRIMARY KEY,
    topic_id TEXT NOT NULL REFERENCES topics(id) ON DELETE CASCADE,
    type TEXT NOT NULL,
    status TEXT DEFAULT 'pending',
    progress REAL DEFAULT 0.0,
    message TEXT,
    error_msg TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_videos_topic ON videos(topic_id);
CREATE INDEX IF NOT EXISTS idx_videos_creator ON videos(creator_id);
CREATE INDEX IF NOT EXISTS idx_videos_platform ON videos(platform);
CREATE INDEX IF NOT EXISTS idx_creators_topic ON creators(topic_id);
CREATE INDEX IF NOT EXISTS idx_tasks_topic ON tasks(topic_id);
CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status);
"""


async def _run_sqlite_migrations(conn) -> None:
    """Add columns that may be missing in older databases."""
    try:
        cur = await conn.execute("PRAGMA table_info(topics)")
        cols = {row[1] for row in await cur.fetchall()}
        if "max_creators" not in cols:
            await conn.execute("ALTER TABLE topics ADD COLUMN max_creators INTEGER NOT NULL DEFAULT 10")
            logger.info("Migration: added topics.max_creators")
        if "max_videos_per_creator" not in cols:
            await conn.execute("ALTER TABLE topics ADD COLUMN max_videos_per_creator INTEGER NOT NULL DEFAULT 0")
            logger.info("Migration: added topics.max_videos_per_creator")
    except Exception as e:
        logger.warning(f"SQLite migration check failed (non-fatal): {e}")


async def _init_pg(conn) -> None:
    """Initialize PostgreSQL schema."""
    await conn.execute("""
        CREATE TABLE IF NOT EXISTS topics (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            platforms JSONB NOT NULL DEFAULT '[]',
            max_creators INTEGER NOT NULL DEFAULT 10,
            max_videos_per_creator INTEGER NOT NULL DEFAULT 0,
            status TEXT DEFAULT 'idle',
            created_at TIMESTAMPTZ DEFAULT NOW(),
            updated_at TIMESTAMPTZ DEFAULT NOW()
        );
        CREATE TABLE IF NOT EXISTS creators (
            id TEXT PRIMARY KEY,
            platform TEXT NOT NULL,
            platform_uid TEXT NOT NULL,
            name TEXT NOT NULL,
            avatar_url TEXT,
            follower_count INTEGER,
            video_count INTEGER DEFAULT 0,
            topic_id TEXT NOT NULL REFERENCES topics(id) ON DELETE CASCADE,
            UNIQUE(platform, platform_uid, topic_id)
        );
        CREATE TABLE IF NOT EXISTS videos (
            id TEXT PRIMARY KEY,
            platform TEXT NOT NULL,
            platform_video_id TEXT NOT NULL,
            title TEXT NOT NULL,
            description TEXT,
            thumbnail_url TEXT,
            duration INTEGER DEFAULT 0,
            view_count INTEGER,
            like_count INTEGER,
            published_at TEXT,
            creator_id TEXT REFERENCES creators(id),
            creator_name TEXT,
            topic_id TEXT NOT NULL REFERENCES topics(id) ON DELETE CASCADE,
            has_transcript BOOLEAN DEFAULT FALSE,
            transcript_source TEXT,
            created_at TIMESTAMPTZ DEFAULT NOW(),
            UNIQUE(platform, platform_video_id, topic_id)
        );
        CREATE TABLE IF NOT EXISTS transcripts (
            id TEXT PRIMARY KEY,
            video_id TEXT NOT NULL REFERENCES videos(id) ON DELETE CASCADE,
            source TEXT NOT NULL,
            language TEXT DEFAULT 'zh',
            segments JSONB NOT NULL DEFAULT '[]',
            full_text TEXT NOT NULL,
            search_vector TSVECTOR,
            created_at TIMESTAMPTZ DEFAULT NOW(),
            UNIQUE(video_id)
        );
        CREATE TABLE IF NOT EXISTS tasks (
            id TEXT PRIMARY KEY,
            topic_id TEXT NOT NULL REFERENCES topics(id) ON DELETE CASCADE,
            type TEXT NOT NULL,
            status TEXT DEFAULT 'pending',
            progress REAL DEFAULT 0.0,
            message TEXT,
            error_msg TEXT,
            created_at TIMESTAMPTZ DEFAULT NOW(),
            updated_at TIMESTAMPTZ DEFAULT NOW()
        );
    """)
    await conn.execute("""
        CREATE INDEX IF NOT EXISTS idx_transcripts_fts ON transcripts USING GIN(search_vector);
    """)
    await conn.execute("""
        CREATE OR REPLACE FUNCTION transcripts_search_update() RETURNS TRIGGER AS $$
        BEGIN
            NEW.search_vector := to_tsvector('simple', COALESCE(NEW.full_text, ''));
            RETURN NEW;
        END;
        $$ LANGUAGE plpgsql;
    """)
    await conn.execute("""
        DO $$ BEGIN
            CREATE TRIGGER transcripts_search_trigger
                BEFORE INSERT OR UPDATE ON transcripts
                FOR EACH ROW EXECUTE FUNCTION transcripts_search_update();
        EXCEPTION WHEN duplicate_object THEN NULL;
        END $$;
    """)
    # Migrations for existing PG databases
    try:
        cols = await conn.fetch("SELECT column_name FROM information_schema.columns WHERE table_name = 'topics'")
        col_names = {r["column_name"] for r in cols}
        if "max_creators" not in col_names:
            await conn.execute("ALTER TABLE topics ADD COLUMN max_creators INTEGER NOT NULL DEFAULT 10")
        if "max_videos_per_creator" not in col_names:
            await conn.execute("ALTER TABLE topics ADD COLUMN max_videos_per_creator INTEGER NOT NULL DEFAULT 0")
    except Exception as e:
        logger.warning(f"PG migration check failed (non-fatal): {e}")

    logger.info("PostgreSQL schema initialized")


# ── Topics ──────────────────────────────────────────────────────────

async def find_topic_by_exact_name(name: str) -> dict[str, Any] | None:
    """Return an existing topic whose name matches exactly (case-insensitive)."""
    if _is_pg:
        row = await _exec("""
            SELECT t.*,
                   COUNT(DISTINCT v.id) as video_count,
                   COUNT(DISTINCT CASE WHEN v.has_transcript THEN v.id END) as transcribed_count,
                   COUNT(DISTINCT c.id) as creator_count
            FROM topics t
            LEFT JOIN videos v ON v.topic_id = t.id
            LEFT JOIN creators c ON c.topic_id = t.id
            WHERE LOWER(t.name) = LOWER($1) GROUP BY t.id
            ORDER BY t.created_at DESC LIMIT 1
        """, (name,), fetchone=True)
    else:
        row = await _exec("""
            SELECT t.*,
                   COUNT(DISTINCT v.id) as video_count,
                   COUNT(DISTINCT CASE WHEN v.has_transcript = 1 THEN v.id END) as transcribed_count,
                   COUNT(DISTINCT c.id) as creator_count
            FROM topics t
            LEFT JOIN videos v ON v.topic_id = t.id
            LEFT JOIN creators c ON c.topic_id = t.id
            WHERE LOWER(t.name) = LOWER(?) GROUP BY t.id
            ORDER BY t.created_at DESC LIMIT 1
        """, (name,), fetchone=True)
    return _topic_row(row) if row else None


async def insert_topic(name: str, platforms: list[str], max_creators: int = 10, max_videos_per_creator: int = 0) -> dict[str, Any]:
    tid = _new_id()
    now = _now()
    if _is_pg:
        await _exec(
            "INSERT INTO topics (id, name, platforms, max_creators, max_videos_per_creator, status, created_at, updated_at) VALUES ($1,$2,$3,$4,$5,'idle',$6,$7)",
            (tid, name, json.dumps(platforms), max_creators, max_videos_per_creator, now, now),
        )
    else:
        await _exec(
            "INSERT INTO topics (id, name, platforms, max_creators, max_videos_per_creator, status, created_at, updated_at) VALUES (?,?,?,?,?,'idle',?,?)",
            (tid, name, json.dumps(platforms), max_creators, max_videos_per_creator, now, now),
        )
    return {"id": tid, "name": name, "platforms": platforms, "maxCreators": max_creators, "maxVideosPerCreator": max_videos_per_creator, "status": "idle", "createdAt": now, "updatedAt": now}


async def get_topics() -> list[dict[str, Any]]:
    if _is_pg:
        rows = await _exec("""
            SELECT t.*,
                   COUNT(DISTINCT v.id) as video_count,
                   COUNT(DISTINCT CASE WHEN v.has_transcript THEN v.id END) as transcribed_count,
                   COUNT(DISTINCT c.id) as creator_count
            FROM topics t
            LEFT JOIN videos v ON v.topic_id = t.id
            LEFT JOIN creators c ON c.topic_id = t.id
            GROUP BY t.id ORDER BY t.created_at DESC
        """, fetch=True)
    else:
        rows = await _exec("""
            SELECT t.*,
                   COUNT(DISTINCT v.id) as video_count,
                   COUNT(DISTINCT CASE WHEN v.has_transcript = 1 THEN v.id END) as transcribed_count,
                   COUNT(DISTINCT c.id) as creator_count
            FROM topics t
            LEFT JOIN videos v ON v.topic_id = t.id
            LEFT JOIN creators c ON c.topic_id = t.id
            GROUP BY t.id ORDER BY t.created_at DESC
        """, fetch=True)
    return [_topic_row(r) for r in rows]


async def get_topic(topic_id: str) -> dict[str, Any] | None:
    if _is_pg:
        row = await _exec("""
            SELECT t.*,
                   COUNT(DISTINCT v.id) as video_count,
                   COUNT(DISTINCT CASE WHEN v.has_transcript THEN v.id END) as transcribed_count,
                   COUNT(DISTINCT c.id) as creator_count
            FROM topics t
            LEFT JOIN videos v ON v.topic_id = t.id
            LEFT JOIN creators c ON c.topic_id = t.id
            WHERE t.id = $1 GROUP BY t.id
        """, (topic_id,), fetchone=True)
    else:
        row = await _exec("""
            SELECT t.*,
                   COUNT(DISTINCT v.id) as video_count,
                   COUNT(DISTINCT CASE WHEN v.has_transcript = 1 THEN v.id END) as transcribed_count,
                   COUNT(DISTINCT c.id) as creator_count
            FROM topics t
            LEFT JOIN videos v ON v.topic_id = t.id
            LEFT JOIN creators c ON c.topic_id = t.id
            WHERE t.id = ? GROUP BY t.id
        """, (topic_id,), fetchone=True)
    return _topic_row(row) if row else None


async def update_topic_status(topic_id: str, status: str) -> None:
    if _is_pg:
        await _exec("UPDATE topics SET status=$1, updated_at=$2 WHERE id=$3", (status, _now(), topic_id))
    else:
        await _exec("UPDATE topics SET status=?, updated_at=? WHERE id=?", (status, _now(), topic_id))


async def update_topic_platforms(topic_id: str, platforms: list[str]) -> None:
    if _is_pg:
        await _exec("UPDATE topics SET platforms=$1, updated_at=$2 WHERE id=$3", (json.dumps(platforms), _now(), topic_id))
    else:
        await _exec("UPDATE topics SET platforms=?, updated_at=? WHERE id=?", (json.dumps(platforms), _now(), topic_id))


async def delete_topic(topic_id: str) -> bool:
    if _is_pg:
        result = await _exec("DELETE FROM topics WHERE id=$1", (topic_id,))
        return "DELETE 1" in str(result)
    else:
        cur = await _exec("DELETE FROM topics WHERE id=?", (topic_id,))
        return cur.rowcount > 0


def _topic_row(row: dict) -> dict[str, Any]:
    platforms = row["platforms"]
    if isinstance(platforms, str):
        platforms = json.loads(platforms)
    return {
        "id": row["id"],
        "name": row["name"],
        "platforms": platforms,
        "maxCreators": row.get("max_creators") or 10,
        "maxVideosPerCreator": row.get("max_videos_per_creator") or 0,
        "status": row["status"],
        "videoCount": row.get("video_count") or 0,
        "transcribedCount": row.get("transcribed_count") or 0,
        "creatorCount": row.get("creator_count") or 0,
        "createdAt": str(row["created_at"]),
        "updatedAt": str(row["updated_at"]),
    }


# ── Creators ────────────────────────────────────────────────────────

async def upsert_creator(
    platform: str, platform_uid: str, name: str, topic_id: str,
    avatar_url: str | None = None, follower_count: int | None = None,
) -> str:
    cid = _new_id()
    if _is_pg:
        await _exec("""
            INSERT INTO creators (id, platform, platform_uid, name, avatar_url, follower_count, topic_id)
            VALUES ($1,$2,$3,$4,$5,$6,$7)
            ON CONFLICT(platform, platform_uid, topic_id) DO UPDATE SET
                name=EXCLUDED.name, avatar_url=EXCLUDED.avatar_url, follower_count=EXCLUDED.follower_count
        """, (cid, platform, platform_uid, name, avatar_url, follower_count, topic_id))
        row = await _exec(
            "SELECT id FROM creators WHERE platform=$1 AND platform_uid=$2 AND topic_id=$3",
            (platform, platform_uid, topic_id), fetchone=True,
        )
    else:
        await _exec("""
            INSERT INTO creators (id, platform, platform_uid, name, avatar_url, follower_count, topic_id)
            VALUES (?,?,?,?,?,?,?)
            ON CONFLICT(platform, platform_uid, topic_id) DO UPDATE SET
                name=excluded.name, avatar_url=excluded.avatar_url, follower_count=excluded.follower_count
        """, (cid, platform, platform_uid, name, avatar_url, follower_count, topic_id))
        row = await _exec(
            "SELECT id FROM creators WHERE platform=? AND platform_uid=? AND topic_id=?",
            (platform, platform_uid, topic_id), fetchone=True,
        )
    return row["id"]


async def get_creators(topic_id: str | None = None, search: str | None = None) -> list[dict[str, Any]]:
    ht_cond = "v.has_transcript = TRUE" if _is_pg else "v.has_transcript = 1"
    select_cols = "c.id, c.platform, c.platform_uid, c.name, c.avatar_url, c.follower_count, c.topic_id"

    conditions: list[str] = []
    params: list[Any] = []
    idx = 1

    if topic_id:
        p = f"${idx}" if _is_pg else "?"
        conditions.append(f"c.topic_id = {p}")
        params.append(topic_id)
        idx += 1
    if search and search.strip():
        p = f"${idx}" if _is_pg else "?"
        conditions.append(f"LOWER(c.name) LIKE LOWER({p})")
        params.append(f"%{search.strip()}%")
        idx += 1

    where = f"WHERE {' AND '.join(conditions)}" if conditions else ""
    rows = await _exec(f"""
        SELECT {select_cols},
               COUNT(DISTINCT v.id) as video_count,
               COUNT(DISTINCT CASE WHEN {ht_cond} THEN v.id END) as transcribed_count,
               COALESCE(SUM(v.view_count), 0) as total_views
        FROM creators c
        LEFT JOIN videos v ON v.creator_id = c.id
        {where}
        GROUP BY c.id ORDER BY video_count DESC, c.name
    """, tuple(params) if params else (), fetch=True)
    return [_creator_row(r) for r in rows]


def _creator_row(r: dict) -> dict[str, Any]:
    return {
        "id": r["id"],
        "platform": r["platform"],
        "platformUid": r["platform_uid"],
        "name": r["name"],
        "avatarUrl": r.get("avatar_url"),
        "videoCount": r.get("video_count") or 0,
        "transcribedCount": r.get("transcribed_count") or 0,
        "totalViews": r.get("total_views") or 0,
        "topicId": r["topic_id"],
    }


# ── Videos ──────────────────────────────────────────────────────────

async def upsert_video(
    platform: str, platform_video_id: str, title: str, topic_id: str,
    creator_id: str, creator_name: str, **kwargs: Any,
) -> str:
    vid = _new_id()
    args = (
        vid, platform, platform_video_id, title,
        kwargs.get("description"), kwargs.get("thumbnail_url"),
        kwargs.get("duration", 0), kwargs.get("view_count"), kwargs.get("like_count"),
        kwargs.get("published_at"), creator_id, creator_name, topic_id,
    )
    if _is_pg:
        await _exec("""
            INSERT INTO videos (id,platform,platform_video_id,title,description,thumbnail_url,
                duration,view_count,like_count,published_at,creator_id,creator_name,topic_id)
            VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
            ON CONFLICT(platform, platform_video_id, topic_id) DO UPDATE SET
                title=EXCLUDED.title, description=EXCLUDED.description, thumbnail_url=EXCLUDED.thumbnail_url,
                view_count=EXCLUDED.view_count, like_count=EXCLUDED.like_count
        """, args)
        row = await _exec(
            "SELECT id FROM videos WHERE platform=$1 AND platform_video_id=$2 AND topic_id=$3",
            (platform, platform_video_id, topic_id), fetchone=True,
        )
    else:
        await _exec("""
            INSERT INTO videos (id,platform,platform_video_id,title,description,thumbnail_url,
                duration,view_count,like_count,published_at,creator_id,creator_name,topic_id)
            VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)
            ON CONFLICT(platform, platform_video_id, topic_id) DO UPDATE SET
                title=excluded.title, description=excluded.description, thumbnail_url=excluded.thumbnail_url,
                view_count=excluded.view_count, like_count=excluded.like_count
        """, args)
        row = await _exec(
            "SELECT id FROM videos WHERE platform=? AND platform_video_id=? AND topic_id=?",
            (platform, platform_video_id, topic_id), fetchone=True,
        )
    return row["id"]


async def get_videos(
    topic_id: str | None = None, creator_id: str | None = None,
    platform: str | None = None, has_transcript: bool | None = None,
    search: str | None = None, platform_video_id: str | None = None,
    page: int = 1, page_size: int = 20,
) -> tuple[list[dict[str, Any]], int]:
    conditions: list[str] = []
    params: list[Any] = []
    idx = 0

    def _add(cond_sqlite: str, cond_pg: str, val: Any):
        nonlocal idx
        idx += 1
        conditions.append(cond_pg if _is_pg else cond_sqlite)
        params.append(val)

    if topic_id:
        _add("v.topic_id = ?", f"v.topic_id = ${idx + 1}", topic_id)
    if creator_id:
        _add("v.creator_id = ?", f"v.creator_id = ${idx + 1}", creator_id)
    if platform:
        _add("v.platform = ?", f"v.platform = ${idx + 1}", platform)
    if platform_video_id:
        _add("v.platform_video_id = ?", f"v.platform_video_id = ${idx + 1}", platform_video_id)
    if has_transcript is not None:
        if _is_pg:
            _add("", f"v.has_transcript = ${idx + 1}", has_transcript)
        else:
            _add("v.has_transcript = ?", "", 1 if has_transcript else 0)
    if search:
        if _is_pg:
            _add("", f"v.id IN (SELECT video_id FROM transcripts WHERE search_vector @@ plainto_tsquery('simple', ${idx + 1}))", search)
        else:
            _add("v.id IN (SELECT video_id FROM transcripts_fts WHERE full_text MATCH ?)", "", search)

    where = (" WHERE " + " AND ".join(conditions)) if conditions else ""

    if _is_pg:
        count_row = await _exec(f"SELECT COUNT(*) as cnt FROM videos v{where}", params, fetchone=True)
        total = count_row["cnt"]
        idx += 1
        limit_p = f"${idx}"
        idx += 1
        offset_p = f"${idx}"
        rows = await _exec(
            f"SELECT v.* FROM videos v{where} ORDER BY v.created_at DESC LIMIT {limit_p} OFFSET {offset_p}",
            params + [page_size, (page - 1) * page_size], fetch=True,
        )
    else:
        count_row = await _exec(f"SELECT COUNT(*) as cnt FROM videos v{where}", params, fetchone=True)
        total = count_row["cnt"]
        offset = (page - 1) * page_size
        rows = await _exec(
            f"SELECT v.* FROM videos v{where} ORDER BY v.created_at DESC LIMIT ? OFFSET ?",
            params + [page_size, offset], fetch=True,
        )

    return [_video_row(r) for r in rows], total


async def get_video(video_id: str) -> dict[str, Any] | None:
    p = "$1" if _is_pg else "?"
    row = await _exec(f"SELECT * FROM videos WHERE id = {p}", (video_id,), fetchone=True)
    return _video_row(row) if row else None


def _video_row(row: dict) -> dict[str, Any]:
    ht = row["has_transcript"]
    return {
        "id": row["id"],
        "platform": row["platform"],
        "platformVideoId": row["platform_video_id"],
        "title": row["title"],
        "description": row.get("description"),
        "thumbnailUrl": row.get("thumbnail_url"),
        "duration": row.get("duration") or 0,
        "viewCount": row.get("view_count"),
        "likeCount": row.get("like_count"),
        "publishedAt": row.get("published_at"),
        "creatorId": row.get("creator_id"),
        "creatorName": row.get("creator_name"),
        "topicId": row["topic_id"],
        "hasTranscript": bool(ht),
        "transcriptSource": row.get("transcript_source"),
    }


# ── Transcripts ─────────────────────────────────────────────────────

async def insert_transcript(
    video_id: str, source: str, segments: list[dict], full_text: str, language: str = "zh",
) -> str:
    tid = _new_id()
    seg_json = json.dumps(segments, ensure_ascii=False)

    if _is_pg:
        await _exec("""
            INSERT INTO transcripts (id, video_id, source, language, segments, full_text)
            VALUES ($1,$2,$3,$4,$5::jsonb,$6)
            ON CONFLICT (video_id) DO UPDATE SET
                source=EXCLUDED.source, segments=EXCLUDED.segments, full_text=EXCLUDED.full_text
        """, (tid, video_id, source, language, seg_json, full_text))
        await _exec("UPDATE videos SET has_transcript=TRUE, transcript_source=$1 WHERE id=$2", (source, video_id))
    else:
        await _exec(
            "INSERT OR REPLACE INTO transcripts (id, video_id, source, language, segments, full_text) VALUES (?,?,?,?,?,?)",
            (tid, video_id, source, language, seg_json, full_text),
        )
        await _exec("UPDATE videos SET has_transcript=1, transcript_source=? WHERE id=?", (source, video_id))
    return tid


async def get_transcript(video_id: str) -> dict[str, Any] | None:
    p = "$1" if _is_pg else "?"
    row = await _exec(f"SELECT * FROM transcripts WHERE video_id = {p}", (video_id,), fetchone=True)
    if not row:
        return None
    segs = row["segments"]
    if isinstance(segs, str):
        segs = json.loads(segs)
    return {
        "videoId": row["video_id"],
        "source": row["source"],
        "language": row["language"],
        "segments": segs,
        "fullText": row["full_text"],
    }


async def get_topic_knowledge(topic_id: str) -> list[dict[str, Any]]:
    """Return all transcripts for a topic, joined with video metadata."""
    if _is_pg:
        rows = await _exec("""
            SELECT v.title, v.creator_name, v.platform, v.platform_video_id,
                   t.full_text
            FROM transcripts t JOIN videos v ON v.id = t.video_id
            WHERE v.topic_id = $1
            ORDER BY v.created_at
        """, (topic_id,), fetch=True)
    else:
        rows = await _exec("""
            SELECT v.title, v.creator_name, v.platform, v.platform_video_id,
                   t.full_text
            FROM transcripts t JOIN videos v ON v.id = t.video_id
            WHERE v.topic_id = ?
            ORDER BY v.created_at
        """, (topic_id,), fetch=True)

    return [{
        "videoTitle": r["title"],
        "creatorName": r.get("creator_name", ""),
        "platform": r["platform"],
        "platformVideoId": r["platform_video_id"],
        "text": r["full_text"],
    } for r in rows]


async def search_transcripts(query: str, topic_id: str | None = None) -> list[dict[str, Any]]:
    if _is_pg:
        if topic_id:
            rows = await _exec("""
                SELECT t.video_id, t.full_text, v.title, v.creator_name, v.platform,
                       v.platform_video_id,
                       ts_rank(t.search_vector, plainto_tsquery('simple', $1)) as rank
                FROM transcripts t JOIN videos v ON v.id = t.video_id
                WHERE t.search_vector @@ plainto_tsquery('simple', $1) AND v.topic_id = $2
                ORDER BY rank DESC LIMIT 15
            """, (query, topic_id), fetch=True)
        else:
            rows = await _exec("""
                SELECT t.video_id, t.full_text, v.title, v.creator_name, v.platform,
                       v.platform_video_id,
                       ts_rank(t.search_vector, plainto_tsquery('simple', $1)) as rank
                FROM transcripts t JOIN videos v ON v.id = t.video_id
                WHERE t.search_vector @@ plainto_tsquery('simple', $1)
                ORDER BY rank DESC LIMIT 15
            """, (query,), fetch=True)
    else:
        base = """
            SELECT fts.video_id, fts.full_text,
                   snippet(transcripts_fts, 0, '<b>', '</b>', '...', 64) as snippet,
                   v.title, v.creator_name, v.platform, v.platform_video_id, rank
            FROM transcripts_fts fts JOIN videos v ON v.id = fts.video_id
        """
        if topic_id:
            rows = await _exec(base + " WHERE fts.full_text MATCH ? AND v.topic_id = ? ORDER BY rank LIMIT 15",
                               (query, topic_id), fetch=True)
        else:
            rows = await _exec(base + " WHERE fts.full_text MATCH ? ORDER BY rank LIMIT 15",
                               (query,), fetch=True)

    results = []
    for r in rows:
        results.append({
            "videoId": r["video_id"],
            "videoTitle": r.get("title", ""),
            "creatorName": r.get("creator_name", ""),
            "platform": r.get("platform", ""),
            "platformVideoId": r.get("platform_video_id", ""),
            "snippet": r.get("snippet", r.get("full_text", "")[:300]),
            "score": abs(r.get("rank", 0)),
        })
    return results


# ── Tasks ───────────────────────────────────────────────────────────

async def insert_task(topic_id: str, task_type: str) -> str:
    tid = _new_id()
    now = _now()
    if _is_pg:
        await _exec(
            "INSERT INTO tasks (id,topic_id,type,status,progress,created_at,updated_at) VALUES ($1,$2,$3,'pending',0.0,$4,$5)",
            (tid, topic_id, task_type, now, now),
        )
    else:
        await _exec(
            "INSERT INTO tasks (id,topic_id,type,status,progress,created_at,updated_at) VALUES (?,?,?,'pending',0.0,?,?)",
            (tid, topic_id, task_type, now, now),
        )
    return tid


_TASK_ALLOWED_COLUMNS = frozenset({"status", "progress", "message", "error_msg"})

async def update_task(task_id: str, **kwargs: Any) -> None:
    for k in kwargs:
        if k not in _TASK_ALLOWED_COLUMNS:
            raise ValueError(f"update_task: disallowed column '{k}'")

    now = _now()
    if _is_pg:
        sets = ["updated_at = $1"]
        params: list[Any] = [now]
        i = 2
        for k, v in kwargs.items():
            sets.append(f"{k} = ${i}")
            params.append(v)
            i += 1
        params.append(task_id)
        await _exec(f"UPDATE tasks SET {', '.join(sets)} WHERE id = ${i}", params)
    else:
        sets = ["updated_at = ?"]
        params = [now]
        for k, v in kwargs.items():
            sets.append(f"{k} = ?")
            params.append(v)
        params.append(task_id)
        await _exec(f"UPDATE tasks SET {', '.join(sets)} WHERE id = ?", params)


async def get_task(task_id: str) -> dict[str, Any] | None:
    p = "$1" if _is_pg else "?"
    r = await _exec(f"SELECT * FROM tasks WHERE id = {p}", (task_id,), fetchone=True)
    if not r:
        return None
    return _task_row(r)


async def get_recent_tasks(limit: int = 20) -> list[dict[str, Any]]:
    if _is_pg:
        rows = await _exec(
            """SELECT t.*, tp.name as topic_name
               FROM tasks t
               LEFT JOIN topics tp ON tp.id = t.topic_id
               ORDER BY t.created_at DESC LIMIT $1""",
            (limit,), fetch=True,
        )
    else:
        rows = await _exec(
            """SELECT t.*, tp.name as topic_name
               FROM tasks t
               LEFT JOIN topics tp ON tp.id = t.topic_id
               ORDER BY t.created_at DESC LIMIT ?""",
            (limit,), fetch=True,
        )
    return [_task_row(r) for r in rows]


def _task_row(r: dict) -> dict[str, Any]:
    return {
        "id": r["id"],
        "topicId": r["topic_id"],
        "topicName": r.get("topic_name") or "",
        "type": r["type"],
        "status": r["status"],
        "progress": r["progress"],
        "message": r.get("message"),
        "errorMsg": r.get("error_msg"),
        "createdAt": str(r["created_at"]),
        "updatedAt": str(r["updated_at"]),
    }


# ── Stats ───────────────────────────────────────────────────────────

async def get_stats() -> dict[str, Any]:
    ht_cond = "has_transcript = TRUE" if _is_pg else "has_transcript = 1"

    topics = await _exec("SELECT COUNT(*) as cnt FROM topics", fetchone=True)
    videos = await _exec("SELECT COUNT(*) as cnt FROM videos", fetchone=True)
    transcribed = await _exec(f"SELECT COUNT(*) as cnt FROM videos WHERE {ht_cond}", fetchone=True)
    creators = await _exec("SELECT COUNT(*) as cnt FROM creators", fetchone=True)
    bili = await _exec("SELECT COUNT(*) as cnt FROM videos WHERE platform = 'bilibili'", fetchone=True)
    yt = await _exec("SELECT COUNT(*) as cnt FROM videos WHERE platform = 'youtube'", fetchone=True)

    total_v = videos["cnt"]
    total_t = transcribed["cnt"]
    recent = await get_topics()

    return {
        "totalTopics": topics["cnt"],
        "totalVideos": total_v,
        "totalTranscribed": total_t,
        "totalCreators": creators["cnt"],
        "transcriptionRate": round(total_t / total_v * 100, 1) if total_v > 0 else 0,
        "platformBreakdown": {"bilibili": bili["cnt"], "youtube": yt["cnt"]},
        "recentTopics": recent[:5],
    }
