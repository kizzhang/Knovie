from __future__ import annotations

import asyncio
import os
from pathlib import Path

import pytest

from handlers.bilibili_handler import get_bilibili_subtitle
from handlers.youtube_handler import get_youtube_subtitle
from lib.cache_paths import audio_cache_base, subtitle_cache_path
from services.transcribe_service import _download_audio

DEFAULT_YOUTUBE_ID = "JHEO7cplfk8"
DEFAULT_BILIBILI_ID = "BV11yfXBuERu"
ENV_YOUTUBE_ID = "KNOVIE_TEST_YOUTUBE_ID"
ENV_BILIBILI_ID = "KNOVIE_TEST_BILIBILI_ID"
SUBTITLE_TIMEOUT_SECONDS = 60
AUDIO_TIMEOUT_SECONDS = 300

pytestmark = pytest.mark.network


def _youtube_id() -> str:
    return os.getenv(ENV_YOUTUBE_ID) or DEFAULT_YOUTUBE_ID


def _bilibili_id() -> str:
    return os.getenv(ENV_BILIBILI_ID) or DEFAULT_BILIBILI_ID


def _find_cached_audio(platform: str, video_id: str) -> Path | None:
    base = audio_cache_base(platform, video_id)
    for ext in ["mp3", "m4a", "webm", "wav", "opus", "mp4"]:
        candidate = base.with_suffix(f".{ext}")
        if candidate.exists() and candidate.stat().st_size > 0:
            return candidate
    return None


def _find_cached_youtube_subtitle(video_id: str) -> Path | None:
    pattern = f"youtube_{video_id}*.json3"
    candidates = sorted(subtitle_cache_path("youtube", video_id, "").parent.glob(pattern))
    return candidates[0] if candidates else None


def _assert_valid_segments(segments: list[dict]) -> None:
    assert isinstance(segments, list)
    assert segments

    for segment in segments:
        assert {"start", "end", "text"} <= segment.keys()
        assert isinstance(segment["start"], (int, float))
        assert isinstance(segment["end"], (int, float))
        assert segment["start"] <= segment["end"]
        assert isinstance(segment["text"], str)
        assert segment["text"].strip()


def _assert_valid_audio_path(path: str | Path) -> Path:
    final_path = Path(path)
    assert final_path.exists()
    assert final_path.stat().st_size > 0
    return final_path


@pytest.mark.asyncio
async def test_youtube_subtitle_download() -> None:
    video_id = _youtube_id()

    segments = await asyncio.wait_for(
        get_youtube_subtitle(video_id),
        timeout=SUBTITLE_TIMEOUT_SECONDS,
    )

    assert segments is not None
    _assert_valid_segments(segments)

    cache_path = _find_cached_youtube_subtitle(video_id)
    assert cache_path is not None
    assert cache_path.exists()


@pytest.mark.asyncio
async def test_youtube_audio_download() -> None:
    video_id = _youtube_id()

    path = await asyncio.wait_for(
        _download_audio({"platform": "youtube", "platformVideoId": video_id}),
        timeout=AUDIO_TIMEOUT_SECONDS,
    )

    assert path is not None
    _assert_valid_audio_path(path)


@pytest.mark.asyncio
async def test_bilibili_subtitle_download() -> None:
    bvid = _bilibili_id()

    segments = await asyncio.wait_for(
        get_bilibili_subtitle(bvid),
        timeout=SUBTITLE_TIMEOUT_SECONDS,
    )

    if segments is None:
        pytest.xfail(
            f"Bilibili subtitle unavailable for {bvid}. "
            f"Set {ENV_BILIBILI_ID} to a subtitle-enabled video if you want a strict pass/fail check."
        )
    _assert_valid_segments(segments)


@pytest.mark.asyncio
async def test_bilibili_audio_download() -> None:
    bvid = _bilibili_id()

    path = await asyncio.wait_for(
        _download_audio({"platform": "bilibili", "platformVideoId": bvid}),
        timeout=AUDIO_TIMEOUT_SECONDS,
    )

    assert path is not None
    _assert_valid_audio_path(path)

    cache_path = _find_cached_audio("bilibili", bvid)
    assert cache_path is not None
