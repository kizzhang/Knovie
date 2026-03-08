-- PostgreSQL initial schema migration
-- Run with: psql $DATABASE_URL -f 001_init.sql

BEGIN;

CREATE TABLE IF NOT EXISTS topics (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    platforms JSONB NOT NULL DEFAULT '[]',
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

-- Full-text search GIN index
CREATE INDEX IF NOT EXISTS idx_transcripts_fts ON transcripts USING GIN(search_vector);

-- Auto-update search_vector on INSERT/UPDATE
CREATE OR REPLACE FUNCTION transcripts_search_update() RETURNS TRIGGER AS $$
BEGIN
    NEW.search_vector := to_tsvector('simple', COALESCE(NEW.full_text, ''));
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DO $$ BEGIN
    CREATE TRIGGER transcripts_search_trigger
        BEFORE INSERT OR UPDATE ON transcripts
        FOR EACH ROW EXECUTE FUNCTION transcripts_search_update();
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Useful indexes
CREATE INDEX IF NOT EXISTS idx_videos_topic ON videos(topic_id);
CREATE INDEX IF NOT EXISTS idx_videos_platform ON videos(platform);
CREATE INDEX IF NOT EXISTS idx_creators_topic ON creators(topic_id);
CREATE INDEX IF NOT EXISTS idx_tasks_topic ON tasks(topic_id);

COMMIT;
