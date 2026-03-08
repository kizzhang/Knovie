from __future__ import annotations

import re

from fastapi import APIRouter, HTTPException, Query

from lib import db

router = APIRouter(tags=["videos"])


def _extract_video_id_from_url(url: str) -> tuple[str, str] | None:
    """Extract (platform, platform_video_id) from a video URL."""
    url = url.strip()
    # Bilibili: bilibili.com/video/BVxxxxx or b23.tv/xxxxx
    m = re.search(r"bilibili\.com/video/(BV[\w]+)", url)
    if m:
        return ("bilibili", m.group(1))
    m = re.search(r"b23\.tv/([\w]+)", url)
    if m:
        return ("bilibili", m.group(1))
    # YouTube: youtube.com/watch?v=xxxxx or youtu.be/xxxxx
    m = re.search(r"(?:youtube\.com/watch\?.*v=|youtu\.be/)([\w\-]+)", url)
    if m:
        return ("youtube", m.group(1))
    return None


@router.get("/videos")
async def list_videos(
    topicId: str | None = None,
    creatorId: str | None = None,
    platform: str | None = None,
    hasTranscript: bool | None = None,
    search: str | None = None,
    url: str | None = None,
    page: int = Query(1, ge=1),
    pageSize: int = Query(20, ge=1, le=100),
):
    if url and url.strip():
        parsed = _extract_video_id_from_url(url)
        if not parsed:
            return {"videos": [], "total": 0, "page": 1, "pageSize": pageSize, "error": "无法解析该链接"}
        plat, vid = parsed
        videos, total = await db.get_videos(
            topic_id=topicId, platform=plat, platform_video_id=vid,
            page=1, page_size=1,
        )
        return {"videos": videos, "total": total, "page": 1, "pageSize": pageSize}

    videos, total = await db.get_videos(
        topic_id=topicId, creator_id=creatorId, platform=platform,
        has_transcript=hasTranscript, search=search, page=page, page_size=pageSize,
    )
    return {"videos": videos, "total": total, "page": page, "pageSize": pageSize}


@router.get("/videos/{video_id}")
async def get_video(video_id: str):
    video = await db.get_video(video_id)
    if not video:
        raise HTTPException(404, "Video not found")
    transcript = await db.get_transcript(video_id)
    return {**video, "transcript": transcript}


@router.get("/videos/{video_id}/transcript")
async def get_video_transcript(video_id: str):
    transcript = await db.get_transcript(video_id)
    if not transcript:
        raise HTTPException(404, "Transcript not found")
    video = await db.get_video(video_id)
    return {
        "videoTitle": video["title"] if video else "",
        "creatorName": video["creatorName"] if video else "",
        **transcript,
    }
