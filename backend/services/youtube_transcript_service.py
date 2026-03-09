"""Fetch YouTube subtitles via youtube-transcript-api (no subprocess, no API key)."""
from __future__ import annotations

import asyncio
from concurrent.futures import ThreadPoolExecutor

from loguru import logger

_executor = ThreadPoolExecutor(max_workers=2)

_LANG_PRIORITY = ["zh-Hans", "zh-CN", "zh-TW", "zh", "en", "en-US", "en-GB"]


async def fetch_transcript(video_id: str) -> list[dict] | None:
    """Fetch subtitles for a YouTube video using youtube-transcript-api.

    Returns list of {start, end, text} or None if unavailable.
    """
    loop = asyncio.get_running_loop()
    try:
        return await loop.run_in_executor(_executor, _fetch_sync, video_id)
    except Exception as e:
        logger.warning(f"[yt-transcript-api] failed for {video_id}: {e}")
        return None


def _fetch_sync(video_id: str) -> list[dict] | None:
    try:
        from youtube_transcript_api import YouTubeTranscriptApi
    except ImportError:
        logger.warning("youtube-transcript-api not installed")
        return None

    ytt = YouTubeTranscriptApi()

    try:
        transcript_list = ytt.list(video_id)
    except Exception as e:
        logger.info(f"[yt-transcript-api] cannot list transcripts for {video_id}: {e}")
        return None

    transcript = _pick_best_transcript(transcript_list)
    if transcript is None:
        logger.info(f"[yt-transcript-api] no suitable transcript found for {video_id}")
        return None

    try:
        fetched = transcript.fetch()
        segments = []
        for snippet in fetched:
            start = round(float(snippet.start), 2)
            duration = float(snippet.duration) if snippet.duration else 0
            segments.append({
                "start": start,
                "end": round(start + duration, 2),
                "text": snippet.text.strip(),
            })

        if segments:
            logger.info(
                f"[yt-transcript-api] success video_id={video_id} "
                f"lang={transcript.language_code} segments={len(segments)} "
                f"generated={transcript.is_generated}"
            )
        return segments if segments else None

    except Exception as e:
        logger.warning(f"[yt-transcript-api] fetch failed for {video_id}: {e}")
        return None


def _pick_best_transcript(transcript_list):
    """Pick the best transcript: prefer manual over auto-generated, prefer our language priority."""
    manual = []
    generated = []
    for t in transcript_list:
        if t.is_generated:
            generated.append(t)
        else:
            manual.append(t)

    for source_label, candidates in [("manual", manual), ("auto", generated)]:
        for lang in _LANG_PRIORITY:
            for t in candidates:
                if t.language_code == lang:
                    return t
        if candidates:
            return candidates[0]

    return None
