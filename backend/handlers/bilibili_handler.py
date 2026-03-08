from __future__ import annotations

import asyncio
import re

from loguru import logger

from lib import db
from lib.config import BILIBILI_SESSDATA

try:
    from bilibili_api import search, video as bvideo, Credential
    from bilibili_api.search import SearchObjectType
    _HAS_BILI_LIB = True
except ImportError:
    _HAS_BILI_LIB = False
    logger.warning("bilibili-api-python not available")

DEFAULT_MAX_CREATORS = 10
DEFAULT_MAX_PAGES = 5
VIDEOS_PER_PAGE = 20

_credential = Credential(sessdata=BILIBILI_SESSDATA) if (BILIBILI_SESSDATA and _HAS_BILI_LIB) else None


async def scrape_bilibili(topic_id: str, keyword: str, *, max_creators: int = 0, max_videos_per_creator: int = 0) -> None:
    """Scrape Bilibili by searching videos directly."""
    if not _HAS_BILI_LIB:
        logger.error("bilibili-api-python is required for Bilibili scraping")
        return

    effective_max_creators = max_creators if max_creators > 0 else DEFAULT_MAX_CREATORS
    max_pages = DEFAULT_MAX_PAGES

    logger.info(f"Scraping Bilibili for topic '{keyword}' (max_creators={effective_max_creators}, max_videos_per_creator={'unlimited' if max_videos_per_creator <= 0 else max_videos_per_creator})")

    total_saved = 0
    creators_seen: dict[int, str] = {}
    creator_video_count: dict[int, int] = {}

    for page in range(1, max_pages + 1):
        if len(creators_seen) >= effective_max_creators:
            all_capped = True
            for mid in creators_seen:
                if max_videos_per_creator <= 0 or creator_video_count.get(mid, 0) < max_videos_per_creator:
                    all_capped = False
                    break
            if all_capped:
                break

        try:
            result = await search.search_by_type(
                keyword,
                search_type=SearchObjectType.VIDEO,
                page=page,
            )
            items = result.get("result", [])
            if not items:
                break

            for item in items:
                mid = item.get("mid", 0)
                author = item.get("author", "")
                bvid = item.get("bvid", "")
                if not bvid or not mid:
                    continue

                if mid not in creators_seen:
                    if len(creators_seen) >= effective_max_creators:
                        continue
                    creator_id = await db.upsert_creator(
                        platform="bilibili",
                        platform_uid=str(mid),
                        name=author,
                        topic_id=topic_id,
                        avatar_url=_fix_protocol(item.get("upic", "")),
                    )
                    creators_seen[mid] = creator_id
                    creator_video_count[mid] = 0
                else:
                    creator_id = creators_seen[mid]

                if max_videos_per_creator > 0 and creator_video_count.get(mid, 0) >= max_videos_per_creator:
                    continue

                try:
                    title = re.sub(r"<[^>]+>", "", item.get("title", ""))
                    await db.upsert_video(
                        platform="bilibili",
                        platform_video_id=bvid,
                        title=title,
                        topic_id=topic_id,
                        creator_id=creator_id,
                        creator_name=author,
                        description=item.get("description", ""),
                        thumbnail_url=_fix_protocol(item.get("pic", "")),
                        duration=_parse_duration_str(item.get("duration", "0")),
                        view_count=item.get("play", 0) if isinstance(item.get("play"), int) else 0,
                        like_count=item.get("like", 0) if isinstance(item.get("like"), int) else 0,
                    )
                    total_saved += 1
                    creator_video_count[mid] = creator_video_count.get(mid, 0) + 1
                except Exception as e:
                    logger.error(f"Failed to save video {bvid}: {e}")

            await asyncio.sleep(1.5)

        except Exception as e:
            logger.error(f"Search page {page} failed: {e}")
            break

    logger.info(f"Saved {total_saved} videos from {len(creators_seen)} creators for '{keyword}'")
    return {"saved": total_saved, "creators": len(creators_seen)}


async def get_bilibili_subtitle(bvid: str) -> list[dict] | None:
    """Get subtitles for a Bilibili video."""
    if not _HAS_BILI_LIB:
        return None

    try:
        v = bvideo.Video(bvid=bvid, credential=_credential)
        info = await v.get_info()
        cid = info.get("cid", 0)
        if not cid:
            pages = info.get("pages", [])
            if pages:
                cid = pages[0].get("cid", 0)

        if not cid:
            return None

        player_info = await v.get_player_info(cid=cid)
        subtitles = player_info.get("subtitle", {}).get("subtitles", [])

        if not subtitles:
            return None

        sub_url = None
        for s in subtitles:
            lang = s.get("lan", "")
            if "zh" in lang or "cn" in lang or "ai" in lang.lower():
                sub_url = s.get("subtitle_url", "")
                break
        if not sub_url:
            sub_url = subtitles[0].get("subtitle_url", "")

        if not sub_url:
            return None

        import httpx
        sub_url = _fix_protocol(sub_url)
        async with httpx.AsyncClient(timeout=15) as client:
            resp = await client.get(sub_url)
            resp.raise_for_status()
            body = resp.json().get("body", [])

        segments = []
        for item in body:
            segments.append({
                "start": item.get("from", 0),
                "end": item.get("to", 0),
                "text": item.get("content", ""),
            })
        return segments if segments else None

    except Exception as e:
        logger.warning(f"Failed to get subtitle for {bvid}: {e}")
        return None


def _parse_duration_str(duration: str | int) -> int:
    if isinstance(duration, int):
        return duration
    try:
        parts = str(duration).split(":")
        if len(parts) == 2:
            return int(parts[0]) * 60 + int(parts[1])
        if len(parts) == 3:
            return int(parts[0]) * 3600 + int(parts[1]) * 60 + int(parts[2])
        return int(duration)
    except (ValueError, TypeError):
        return 0


def _fix_protocol(url: str) -> str:
    if url.startswith("//"):
        return "https:" + url
    return url
