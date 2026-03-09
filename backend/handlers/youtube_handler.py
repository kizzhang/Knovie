from __future__ import annotations

import asyncio
import json
import subprocess
import sys
from concurrent.futures import ThreadPoolExecutor

from loguru import logger

from lib import db

_YT_DLP_CMD = [sys.executable, "-m", "yt_dlp"]

DEFAULT_MAX_CREATORS = 10
DEFAULT_MAX_VIDEOS_PER_CREATOR = 0  # 0 = unlimited
_executor = ThreadPoolExecutor(max_workers=2)


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
                    thumbnail_url=v.get("thumbnail", ""),
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
    """Try to get existing subtitles for a YouTube video via yt-dlp."""
    loop = asyncio.get_event_loop()
    return await loop.run_in_executor(_executor, _get_subtitle_sync, video_id)


def _get_subtitle_sync(video_id: str) -> list[dict] | None:
    cmd = [
        *_YT_DLP_CMD, "--skip-download", "--write-auto-sub", "--sub-lang", "zh,en",
        "--sub-format", "json3", "--dump-json",
        "--no-warnings", "--no-check-certificates",
        f"https://www.youtube.com/watch?v={video_id}",
    ]
    try:
        proc = subprocess.run(cmd, capture_output=True, text=True, timeout=60)
        if proc.returncode != 0:
            return None

        data = json.loads(proc.stdout)
        subs = data.get("subtitles", {})
        auto_subs = data.get("automatic_captions", {})

        sub_data = None
        for lang_key in ["zh-Hans", "zh", "zh-CN", "en"]:
            if lang_key in subs:
                sub_data = subs[lang_key]
                break
            if lang_key in auto_subs:
                sub_data = auto_subs[lang_key]
                break

        if not sub_data:
            return None

        # Get json3 format URL and download
        json3_url = None
        for fmt in sub_data:
            if fmt.get("ext") == "json3":
                json3_url = fmt.get("url")
                break

        if not json3_url:
            return None

        import httpx
        resp = httpx.get(json3_url, timeout=30)
        events = resp.json().get("events", [])

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

    except (FileNotFoundError, subprocess.TimeoutExpired, json.JSONDecodeError):
        return None
