from __future__ import annotations

import asyncio
import os
import subprocess
import sys
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

from loguru import logger

from lib import db
from handlers.bilibili_handler import get_bilibili_subtitle
from handlers.youtube_handler import get_youtube_subtitle
from lib.cache_paths import audio_cache_base
from services.groq_whisper_service import transcribe_audio
from services.gemini_transcribe_service import transcribe_youtube_via_gemini
from lib.config import GROQ_API_KEY, GOOGLE_API_KEY

_executor = ThreadPoolExecutor(max_workers=2)


async def transcribe_topic_videos(topic_id: str, task_id: str) -> None:
    """Transcribe all un-transcribed videos for a topic using the fallback chain."""
    videos, total = await db.get_videos(topic_id=topic_id, has_transcript=False, page_size=500)
    if not videos:
        logger.info(f"No videos to transcribe for topic {topic_id}")
        await db.update_task(task_id, progress=0.95, message="没有需要转录的视频")
        return

    total_count = len(videos)
    success_count = 0
    fail_count = 0
    skip_count = 0

    logger.info(f"Transcribing {total_count} videos for topic {topic_id}")

    for i, video in enumerate(videos):
        progress = 0.6 + 0.35 * (i / total_count)
        await db.update_task(
            task_id,
            progress=round(progress, 2),
            message=f"转录中：{video['title'][:25]}... ({i + 1}/{total_count}，成功 {success_count}，失败 {fail_count})",
        )

        try:
            segments = await _transcribe_single(video)
            if segments:
                full_text = " ".join(s["text"] for s in segments)
                source = _determine_source(segments)
                await db.insert_transcript(
                    video_id=video["id"],
                    source=source,
                    segments=segments,
                    full_text=full_text,
                )
                success_count += 1
                logger.info(f"Transcribed: {video['title'][:50]} ({source})")
            else:
                skip_count += 1
                logger.warning(f"No transcript obtained for: {video['title'][:50]}")
        except Exception as e:
            fail_count += 1
            logger.error(f"Failed to transcribe {video['title'][:50]}: {e}")

        await asyncio.sleep(0.5)

    await db.update_task(
        task_id,
        progress=0.95,
        message=f"转录完成：成功 {success_count}，失败 {fail_count}，跳过 {skip_count}（共 {total_count}）",
    )


async def _transcribe_single(video: dict) -> list[dict] | None:
    """Try to transcribe a single video using the fallback chain:
    1. Platform subtitles (free, fastest)
    2. Groq Whisper API (yt-dlp download + Groq, fast)
    3. Gemini direct transcription (YouTube only, slower but no yt-dlp needed)
    4. Skip
    """
    vid = video["platformVideoId"]
    platform = video["platform"]
    logger.info(f"[transcribe] start subtitle lookup platform={platform} video_id={vid}")

    # Step 1: Try platform subtitles
    try:
        if platform == "bilibili":
            segments = await get_bilibili_subtitle(vid)
        elif platform == "youtube":
            segments = await get_youtube_subtitle(vid)
        else:
            segments = None

        if segments:
            logger.info(f"[transcribe] subtitle hit platform={platform} video_id={vid} segments={len(segments)}")
            return [{"start": s["start"], "end": s["end"], "text": s["text"], "_source": "subtitle"} for s in segments]
        logger.info(f"[transcribe] subtitle miss platform={platform} video_id={vid}")
    except Exception as e:
        logger.warning(f"[transcribe] subtitle fetch failed platform={platform} video_id={vid} error={e}")

    # Step 2: Groq Whisper (needs audio download, but fast)
    if GROQ_API_KEY:
        try:
            audio_path = await _download_audio(video)
            if audio_path:
                segments = await transcribe_audio(audio_path)
                return [{"start": s["start"], "end": s["end"], "text": s["text"], "_source": "groq_whisper"} for s in segments]
            else:
                logger.warning(f"Audio download returned empty for {vid}, skip Groq fallback")
        except Exception as e:
            logger.warning(f"Groq Whisper failed for {vid}: {e}")

    # Step 3: Gemini direct transcription (YouTube only — slower fallback)
    if platform == "youtube" and GOOGLE_API_KEY:
        try:
            segments = await transcribe_youtube_via_gemini(vid)
            if segments:
                return [{"start": s["start"], "end": s["end"], "text": s["text"], "_source": "gemini"} for s in segments]
        except Exception as e:
            logger.warning(f"Gemini transcription failed for {vid}: {e}")

    return None


async def _download_audio(video: dict) -> str | None:
    """Download audio for a video using yt-dlp and keep a cached local copy."""
    platform = video["platform"]
    vid = video["platformVideoId"]

    if platform == "bilibili":
        url = f"https://www.bilibili.com/video/{vid}"
    elif platform == "youtube":
        url = f"https://www.youtube.com/watch?v={vid}"
    else:
        return None

    loop = asyncio.get_running_loop()
    return await loop.run_in_executor(_executor, _download_audio_sync, platform, vid, url)


def _download_audio_sync(platform: str, video_id: str, url: str) -> str | None:
    """Download audio to cache dir. Returns cached path or None."""
    base = str(audio_cache_base(platform, video_id))

    cached = _find_cached_audio(base)
    if cached:
        logger.info(f"[audio cache] hit platform={platform} video_id={video_id} path={cached}")
        return cached

    cmd = [
        sys.executable, "-m", "yt_dlp",
        "--extract-audio",
        "--audio-format", "mp3",
        "--audio-quality", "5",
        "--no-warnings",
        "--no-check-certificates",
        "-o", f"{base}.%(ext)s",
        url,
    ]

    try:
        logger.info(f"[audio cache] download start platform={platform} video_id={video_id}")
        proc = subprocess.run(cmd, capture_output=True, text=True, timeout=300)
        if proc.returncode != 0:
            err = (proc.stderr or "").strip().replace("\n", " ")[:300]
            logger.warning(f"yt-dlp exit code {proc.returncode} for {url}; stderr={err}")

        cached = _find_cached_audio(base)
        if cached:
            logger.info(f"[audio cache] download success platform={platform} video_id={video_id} path={cached}")
            return cached

        _cleanup_download_files(base)
        return None
    except (FileNotFoundError, subprocess.TimeoutExpired) as e:
        logger.warning(f"Audio download failed: {e}")
        _cleanup_download_files(base)
        return None


def _cleanup_download_files(base: str) -> None:
    """Remove any temp files created during download."""
    for ext in ["mp3", "m4a", "webm", "wav", "opus", "mp4", "part"]:
        path = f"{base}.{ext}"
        if os.path.exists(path):
            try:
                os.unlink(path)
            except OSError:
                pass


def _find_cached_audio(base: str) -> str | None:
    base_path = Path(base)
    for ext in ["mp3", "m4a", "webm", "wav", "opus", "mp4"]:
        candidate = base_path.with_suffix(f".{ext}")
        if candidate.exists() and candidate.stat().st_size > 0:
            return str(candidate)
    return None


def _determine_source(segments: list[dict]) -> str:
    if segments and "_source" in segments[0]:
        return segments[0]["_source"]
    return "subtitle"
