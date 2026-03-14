from __future__ import annotations

import hashlib
import ipaddress
import json
import os
import socket
from pathlib import Path
from urllib.parse import urlparse

from fastapi import APIRouter, Query
from fastapi.responses import FileResponse, Response
from loguru import logger
import httpx

router = APIRouter()

_DEFAULT_CACHE_DIR = Path(__file__).resolve().parents[1] / "cache" / "images"
_raw_cache_dir = os.getenv("IMAGE_CACHE_DIR")
_cache_dir_value = _raw_cache_dir.strip() if _raw_cache_dir else ""
if _cache_dir_value and not _cache_dir_value.startswith("#"):
    CACHE_DIR = Path(_cache_dir_value)
else:
    CACHE_DIR = _DEFAULT_CACHE_DIR

CACHE_DIR.mkdir(parents=True, exist_ok=True)

_FETCH_HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    "Referer": "https://www.bilibili.com",
}

_EXT_MAP = {
    "image/jpeg": ".jpg",
    "image/png": ".png",
    "image/webp": ".webp",
    "image/gif": ".gif",
    "image/avif": ".avif",
    "image/svg+xml": ".svg",
}


def _cache_key(url: str) -> str:
    return hashlib.md5(url.encode()).hexdigest()


def _get_cached_path(key: str) -> Path | None:
    """Return the cached file path if it exists, or None."""
    for ext in _EXT_MAP.values():
        p = CACHE_DIR / f"{key}{ext}"
        if p.exists():
            return p
    return None


def _meta_path(key: str) -> Path:
    return CACHE_DIR / f"{key}.meta"


def _read_meta(key: str) -> dict | None:
    mp = _meta_path(key)
    if mp.exists():
        try:
            return json.loads(mp.read_text(encoding="utf-8"))
        except Exception:
            return None
    return None


async def ensure_cached(url: str) -> Path | None:
    """Download and cache an image if not already cached. Returns local path or None on failure."""
    if not url or not _is_safe_url(url):
        return None

    key = _cache_key(url)
    cached = _get_cached_path(key)
    if cached:
        return cached

    try:
        async with httpx.AsyncClient(follow_redirects=True, timeout=15.0) as client:
            resp = await client.get(url, headers=_FETCH_HEADERS)
            resp.raise_for_status()
    except Exception as e:
        logger.debug(f"Image fetch failed for {url[:80]}: {e}")
        return None

    content_type = resp.headers.get("content-type", "image/jpeg").split(";")[0].strip()
    ext = _EXT_MAP.get(content_type, ".jpg")
    file_path = CACHE_DIR / f"{key}{ext}"

    try:
        file_path.write_bytes(resp.content)
        _meta_path(key).write_text(
            json.dumps({"url": url, "content_type": content_type, "size": len(resp.content)}, ensure_ascii=False),
            encoding="utf-8",
        )
    except Exception as e:
        logger.warning(f"Failed to write cache file {file_path}: {e}")
        return None

    return file_path


async def precache_images(urls: list[str]) -> int:
    """Batch pre-cache a list of image URLs. Returns count of newly cached images."""
    cached = 0
    for url in urls:
        if not url:
            continue
        key = _cache_key(url)
        if _get_cached_path(key):
            continue
        result = await ensure_cached(url)
        if result:
            cached += 1
    return cached


import ipaddress
import socket
from urllib.parse import urlparse

_ALLOWED_HOSTS = {
    "i.hdslb.com", "i0.hdslb.com", "i1.hdslb.com", "i2.hdslb.com",
    "archive.biliimg.com", "s1.hdslb.com",
    "i.ytimg.com", "i9.ytimg.com", "img.youtube.com", "yt3.ggpht.com",
    "yt3.googleusercontent.com",
}

def _is_safe_url(url: str) -> bool:
    """Reject private/internal IPs and non-whitelisted hosts."""
    try:
        parsed = urlparse(url)
        if parsed.scheme not in ("http", "https"):
            return False
        hostname = parsed.hostname or ""
        if not hostname:
            return False
        # Allow whitelisted CDN hosts
        if hostname in _ALLOWED_HOSTS:
            return True
        # Block private IPs
        try:
            resolved = socket.getaddrinfo(hostname, None)
            for _, _, _, _, addr in resolved:
                ip = ipaddress.ip_address(addr[0])
                if ip.is_private or ip.is_loopback or ip.is_reserved or ip.is_link_local:
                    return False
        except (socket.gaierror, ValueError):
            return False
        return True
    except Exception:
        return False


@router.get("/proxy-image")
async def proxy_image(url: str = Query(..., description="Image URL to proxy")):
    if not _is_safe_url(url):
        return Response(status_code=403, content="Forbidden: URL not allowed")

    key = _cache_key(url)
    cached = _get_cached_path(key)

    if cached:
        meta = _read_meta(key)
        media_type = meta["content_type"] if meta else "image/jpeg"
        return FileResponse(
            cached,
            media_type=media_type,
            headers={"Cache-Control": "public, max-age=86400"},
        )

    path = await ensure_cached(url)
    if not path:
        return Response(status_code=404)

    meta = _read_meta(key)
    media_type = meta["content_type"] if meta else "image/jpeg"
    return FileResponse(
        path,
        media_type=media_type,
        headers={"Cache-Control": "public, max-age=86400"},
    )


@router.get("/cache/stats")
async def cache_stats():
    """Return image cache statistics."""
    files = [f for f in CACHE_DIR.iterdir() if f.is_file() and not f.suffix == ".meta"]
    total_size = sum(f.stat().st_size for f in files)
    return {
        "fileCount": len(files),
        "totalSizeBytes": total_size,
        "totalSizeMB": round(total_size / (1024 * 1024), 2),
        "cacheDir": str(CACHE_DIR),
    }


@router.delete("/cache/clear")
async def cache_clear():
    """Clear all cached images."""
    count = 0
    for f in CACHE_DIR.iterdir():
        if f.is_file():
            f.unlink()
            count += 1
    return {"ok": True, "deletedFiles": count}
