from __future__ import annotations

import asyncio
import json
import subprocess
import sys
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

from loguru import logger

from lib import db
from lib.cache_paths import subtitle_cache_path

_YT_DLP_CMD = [sys.executable, "-m", "yt_dlp"]

DEFAULT_MAX_CREATORS = 10
DEFAULT_MAX_VIDEOS_PER_CREATOR = 0  # 0 = unlimited
_executor = ThreadPoolExecutor(max_workers=2)
_YOUTUBE_ZH_LANGS = ["zh-Hans", "zh", "zh-CN", "zh-TW", "zh-HK"]
_YOUTUBE_EN_LANGS = ["en"]


def _get_thumbnail(entry: dict) -> str:
    """Extract best thumbnail URL from yt-dlp entry. flat-playlist sets thumbnail=null."""
    url = entry.get("thumbnail") or ""
    if url:
        return url
    thumbs = entry.get("thumbnails")
    if thumbs and isinstance(thumbs, list):
        best = max(thumbs, key=lambda t: t.get("height", 0) * t.get("width", 0))
        return best.get("url", "")
    vid = entry.get("id", "")
    if vid:
        return f"https://i.ytimg.com/vi/{vid}/hqdefault.jpg"
    return ""


async def scrape_youtube(topic_id: str, keyword: str, *, max_creators: int = 0, max_videos_per_creator: int = 0) -> None:
    effective_max_creators = max_creators if max_creators > 0 else DEFAULT_MAX_CREATORS
    effective_max_videos = max_videos_per_creator if max_videos_per_creator > 0 else DEFAULT_MAX_VIDEOS_PER_CREATOR

    search_limit = effective_max_creators * (effective_max_videos if effective_max_videos > 0 else 20)
    search_limit = min(search_limit, 200)

    logger.info(f"Scraping YouTube for topic '{keyword}' (max_creators={effective_max_creators}, max_videos_per_creator={'unlimited' if effective_max_videos <= 0 else effective_max_videos})")

    try:
        results = await _yt_search(f"{keyword}", search_limit)
    except Exception as e:
        logger.error(f"YouTube search failed: {e}")
        return

    channels: dict[str, dict] = {}
    for entry in results:
        ch_id = entry.get("channel_id") or entry.get("uploader_id") or "unknown"
        ch_name = entry.get("channel") or entry.get("uploader") or "Unknown"
        if ch_id not in channels:
            if len(channels) >= effective_max_creators:
                continue
            channels[ch_id] = {"id": ch_id, "name": ch_name, "videos": []}
        if effective_max_videos > 0 and len(channels[ch_id]["videos"]) >= effective_max_videos:
            continue
        channels[ch_id]["videos"].append(entry)

    count = 0
    for ch_id, ch_data in list(channels.items())[:effective_max_creators]:
        try:
            creator_id = await db.upsert_creator(
                platform="youtube",
                platform_uid=ch_id,
                name=ch_data["name"],
                topic_id=topic_id,
            )

            for v in ch_data["videos"]:
                vid = v.get("id", "")
                if not vid:
                    continue
                await db.upsert_video(
                    platform="youtube",
                    platform_video_id=vid,
                    title=v.get("title", ""),
                    topic_id=topic_id,
                    creator_id=creator_id,
                    creator_name=ch_data["name"],
                    description=v.get("description", ""),
                    thumbnail_url=_get_thumbnail(v),
                    duration=v.get("duration") or 0,
                    view_count=v.get("view_count"),
                    like_count=v.get("like_count"),
                    published_at=v.get("upload_date"),
                )
                count += 1

        except Exception as e:
            logger.error(f"Failed to save YouTube channel {ch_data['name']}: {e}")

    logger.info(f"Saved {count} YouTube videos for '{keyword}'")
    return {"saved": count, "creators": len(channels)}


async def _yt_search(query: str, max_results: int = 50) -> list[dict]:
    """Use yt-dlp to search YouTube."""
    loop = asyncio.get_event_loop()
    return await loop.run_in_executor(_executor, _yt_search_sync, query, max_results)


def _yt_search_sync(query: str, max_results: int) -> list[dict]:
    cmd = [
        *_YT_DLP_CMD, "--flat-playlist", "--dump-json",
        "--no-warnings", "--no-check-certificates",
        f"ytsearch{max_results}:{query}",
    ]
    try:
        proc = subprocess.run(cmd, capture_output=True, text=True, timeout=120)
        results = []
        for line in proc.stdout.strip().split("\n"):
            if line.strip():
                try:
                    results.append(json.loads(line))
                except json.JSONDecodeError:
                    pass
        return results
    except FileNotFoundError:
        logger.warning("yt-dlp not found, YouTube scraping disabled")
        return []
    except subprocess.TimeoutExpired:
        logger.warning("yt-dlp search timed out")
        return []


async def get_youtube_subtitle(video_id: str) -> list[dict] | None:
    """Get YouTube subtitles with fallback chain:
    1. youtube-transcript-api (fast, pure Python)
    2. yt-dlp --write-subs (subprocess, fallback when #1 is IP-blocked)
    """
    from services.youtube_transcript_service import fetch_transcript

    segments = await fetch_transcript(video_id)
    if segments:
        return segments

    logger.info(f"[youtube subtitle] transcript-api miss, falling back to yt-dlp for {video_id}")
    loop = asyncio.get_event_loop()
    return await loop.run_in_executor(_executor, _get_subtitle_sync, video_id)


def _get_subtitle_sync(video_id: str) -> list[dict] | None:
    logger.info(f"[youtube subtitle] start video_id={video_id}")

    cached_path = _find_cached_youtube_subtitle(video_id, _YOUTUBE_ZH_LANGS + _YOUTUBE_EN_LANGS)
    if cached_path:
        logger.info(f"[youtube subtitle] cache hit video_id={video_id} path={cached_path}")
        segments = _parse_youtube_json3(cached_path)
        logger.info(f"[youtube subtitle] parsed cached subtitle video_id={video_id} segments={len(segments) if segments else 0}")
        return segments

    for lang_group, label in [(_YOUTUBE_ZH_LANGS, "zh"), (_YOUTUBE_EN_LANGS, "en")]:
        cache_path = _download_youtube_subtitle(video_id, lang_group, label)
        if not cache_path:
            continue

        logger.info(f"[youtube subtitle] downloaded subtitle video_id={video_id} path={cache_path} preferred={label}")
        segments = _parse_youtube_json3(cache_path)
        logger.info(f"[youtube subtitle] parsed downloaded subtitle video_id={video_id} segments={len(segments) if segments else 0}")
        if segments:
            return segments

    logger.warning(f"[youtube subtitle] no preferred subtitle downloaded video_id={video_id}")
    return None


def _download_youtube_subtitle(video_id: str, langs: list[str], label: str) -> Path | None:
    base_path = subtitle_cache_path("youtube", video_id, "")
    url = f"https://www.youtube.com/watch?v={video_id}"
    existing = _find_cached_youtube_subtitle(video_id, langs)
    if existing:
        logger.info(f"[youtube subtitle] reuse cached subtitle video_id={video_id} path={existing} preferred={label}")
        return existing

    cmd = [
        *_YT_DLP_CMD,
        "--skip-download",
        "--write-subs",
        "--write-auto-subs",
        "--sub-format", "json3",
        "--no-warnings",
        "--no-check-certificates",
        "-o", str(base_path),
        "--sub-langs", ",".join(langs),
    ]
    cmd.append(url)

    try:
        logger.info(f"[youtube subtitle] download attempt video_id={video_id} preferred={label} langs={langs}")
        proc = subprocess.run(cmd, capture_output=True, text=True, timeout=120)
        if proc.returncode != 0:
            err = (proc.stderr or "").strip().replace("\n", " ")[:300]
            logger.warning(
                f"[youtube subtitle] yt-dlp subtitle file download failed "
                f"video_id={video_id} preferred={label} returncode={proc.returncode} stderr={err}"
            )
            return None
    except FileNotFoundError:
        logger.warning("[youtube subtitle] yt-dlp not found during subtitle download")
        return None
    except subprocess.TimeoutExpired:
        logger.warning(f"[youtube subtitle] subtitle file download timed out video_id={video_id}")
        return None

    return _find_cached_youtube_subtitle(video_id, langs)


def _find_cached_youtube_subtitle(video_id: str, preferred_langs: list[str] | None = None) -> Path | None:
    candidates = sorted(subtitle_cache_path("youtube", video_id, "").parent.glob(f"youtube_{video_id}*.json3"))
    if not candidates:
        return None

    if not preferred_langs:
        return candidates[0]

    by_lang = {path: _subtitle_lang(path, video_id) for path in candidates}
    for lang in preferred_langs:
        for path, path_lang in by_lang.items():
            if path_lang == lang:
                return path
    return candidates[0]


def _subtitle_lang(path: Path, video_id: str) -> str:
    prefix = f"youtube_{video_id}."
    name = path.name
    if name.startswith(prefix) and name.endswith(".json3"):
        return name[len(prefix):-len(".json3")]
    return ""


def _parse_youtube_json3(path: Path) -> list[dict] | None:
    try:
        events = json.loads(path.read_text(encoding="utf-8")).get("events", [])
    except (OSError, json.JSONDecodeError):
        return None

    segments = []
    for ev in events:
        start_ms = ev.get("tStartMs", 0)
        dur_ms = ev.get("dDurationMs", 0)
        segs = ev.get("segs", [])
        text = "".join(s.get("utf8", "") for s in segs).strip()
        if text and text != "\n":
            segments.append({
                "start": round(start_ms / 1000, 2),
                "end": round((start_ms + dur_ms) / 1000, 2),
                "text": text,
            })

    return segments if segments else None
