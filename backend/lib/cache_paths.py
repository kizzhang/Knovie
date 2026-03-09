from __future__ import annotations

import os
from pathlib import Path


def _path_from_env(env_name: str, default: Path) -> Path:
    raw_value = os.getenv(env_name)
    value = raw_value.strip() if raw_value else ""
    if value and not value.startswith("#"):
        return Path(value)
    return default


CACHE_ROOT = Path(__file__).resolve().parents[1] / "cache"
SUBTITLE_CACHE_DIR = _path_from_env("SUBTITLE_CACHE_DIR", CACHE_ROOT / "subtitles")
AUDIO_CACHE_DIR = _path_from_env("AUDIO_CACHE_DIR", CACHE_ROOT / "audio")

SUBTITLE_CACHE_DIR.mkdir(parents=True, exist_ok=True)
AUDIO_CACHE_DIR.mkdir(parents=True, exist_ok=True)


def subtitle_cache_path(platform: str, video_id: str, ext: str) -> Path:
    return SUBTITLE_CACHE_DIR / f"{platform}_{video_id}{ext}"


def audio_cache_base(platform: str, video_id: str) -> Path:
    return AUDIO_CACHE_DIR / f"{platform}_{video_id}"
