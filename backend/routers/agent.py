"""YouTube AI Agent API — search and analyze YouTube videos via Gemini."""
from __future__ import annotations

import asyncio
import json
import re
import subprocess
import sys
from concurrent.futures import ThreadPoolExecutor

from fastapi import APIRouter, HTTPException
from loguru import logger
from pydantic import BaseModel

from lib.config import GOOGLE_API_KEY

router = APIRouter(prefix="/agent", tags=["agent"])

_YT_DLP_CMD = [sys.executable, "-m", "yt_dlp"]
_executor = ThreadPoolExecutor(max_workers=3)


# ── Request models ────────────────────────────────────────────────

class SearchRequest(BaseModel):
    query: str
    max_results: int = 10


class AnalyzeRequest(BaseModel):
    video_url: str
    question: str = ""


# ── Search YouTube ────────────────────────────────────────────────

def _yt_search_sync(query: str, max_results: int) -> list[dict]:
    cmd = [
        *_YT_DLP_CMD, "--flat-playlist", "--dump-json",
        "--no-warnings", "--no-check-certificates",
        f"ytsearch{max_results}:{query}",
    ]
    try:
        proc = subprocess.run(cmd, capture_output=True, text=True, timeout=180)
        results = []
        for line in proc.stdout.strip().split("\n"):
            if line.strip():
                try:
                    results.append(json.loads(line))
                except json.JSONDecodeError:
                    pass
        return results
    except FileNotFoundError:
        logger.warning("yt-dlp not found")
        return []
    except subprocess.TimeoutExpired:
        logger.warning("yt-dlp search timed out")
        return []


def _get_thumbnail(entry: dict) -> str:
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


@router.post("/search-youtube")
async def search_youtube(req: SearchRequest):
    """Search YouTube videos via yt-dlp."""
    loop = asyncio.get_running_loop()
    raw = await loop.run_in_executor(
        _executor, _yt_search_sync, req.query, min(req.max_results, 30)
    )

    results = []
    for entry in raw:
        vid = entry.get("id", "")
        if not vid:
            continue
        desc = entry.get("description") or ""
        if len(desc) > 200:
            desc = desc[:200] + "..."
        results.append({
            "id": vid,
            "title": entry.get("title", ""),
            "channel": entry.get("channel") or entry.get("uploader") or "",
            "channelId": entry.get("channel_id") or entry.get("uploader_id") or "",
            "thumbnail": _get_thumbnail(entry),
            "duration": entry.get("duration") or 0,
            "viewCount": entry.get("view_count"),
            "uploadDate": entry.get("upload_date"),
            "description": desc,
            "url": f"https://www.youtube.com/watch?v={vid}",
        })

    return {"results": results, "query": req.query}


# ── Analyze Video ─────────────────────────────────────────────────

_VIDEO_ID_RE = re.compile(
    r"(?:youtube\.com/watch\?v=|youtu\.be/|youtube\.com/embed/)([A-Za-z0-9_-]{11})"
)


def _extract_video_id(url: str) -> str | None:
    m = _VIDEO_ID_RE.search(url)
    return m.group(1) if m else None


def _get_subtitle_text(video_id: str) -> str | None:
    """Try to get subtitle text synchronously."""
    try:
        from youtube_transcript_api import YouTubeTranscriptApi
    except ImportError:
        return None

    ytt = YouTubeTranscriptApi()
    lang_priority = ["zh-Hans", "zh-CN", "zh-TW", "zh", "en", "en-US", "en-GB"]

    try:
        transcript_list = ytt.list(video_id)
    except Exception:
        return None

    manual, generated = [], []
    for t in transcript_list:
        (generated if t.is_generated else manual).append(t)

    chosen = None
    for candidates in [manual, generated]:
        for lang in lang_priority:
            for t in candidates:
                if t.language_code == lang:
                    chosen = t
                    break
            if chosen:
                break
        if chosen:
            break
        if candidates:
            chosen = candidates[0]
            break

    if not chosen:
        return None

    try:
        fetched = chosen.fetch()
        lines = []
        for snippet in fetched:
            start = round(float(snippet.start), 2)
            lines.append(f"[{start}s] {snippet.text.strip()}")
        return "\n".join(lines) if lines else None
    except Exception:
        return None


def _analyze_with_subtitle(video_id: str, subtitle_text: str, question: str) -> str:
    """Analyze video using subtitle text only (cheap, fast)."""
    from google import genai

    client = genai.Client(api_key=GOOGLE_API_KEY)

    MAX_SUBTITLE_CHARS = 300_000
    if len(subtitle_text) > MAX_SUBTITLE_CHARS:
        subtitle_text = subtitle_text[:MAX_SUBTITLE_CHARS] + "\n\n[... 字幕过长，已截断 ...]"

    prompt_parts = [
        "以下是一个 YouTube 视频的字幕内容（含时间戳）。",
        f"视频链接: https://www.youtube.com/watch?v={video_id}",
        "",
        "--- 字幕内容 ---",
        subtitle_text,
        "--- 字幕结束 ---",
        "",
    ]

    if question:
        prompt_parts.append(f"用户问题: {question}")
        prompt_parts.append("")
        prompt_parts.append("请基于字幕内容详细回答用户的问题。引用具体时间戳。")
    else:
        prompt_parts.append(
            "请对这个视频进行深度分析，包括：\n"
            "1. 核心主题和关键观点（附时间戳）\n"
            "2. 内容结构概览\n"
            "3. 重要结论或建议\n"
            "4. 视频质量评估（深度、逻辑性、实用性）"
        )

    response = client.models.generate_content(
        model="gemini-2.5-flash",
        contents=[{"parts": [{"text": "\n".join(prompt_parts)}]}],
    )
    return response.text.strip()


def _analyze_with_video(video_id: str, question: str) -> str:
    """Analyze video via Gemini video understanding (expensive, powerful)."""
    from google import genai

    client = genai.Client(api_key=GOOGLE_API_KEY)
    youtube_url = f"https://www.youtube.com/watch?v={video_id}"

    if question:
        prompt = f"请观看这个视频并回答以下问题：{question}\n\n请引用具体的时间戳。"
    else:
        prompt = (
            "请深度分析这个视频，包括：\n"
            "1. 核心主题和关键观点（附时间戳）\n"
            "2. 视觉内容描述（PPT/图表/演示等）\n"
            "3. 内容结构概览\n"
            "4. 重要结论或建议\n"
            "5. 视频质量评估"
        )

    response = client.models.generate_content(
        model="gemini-2.5-flash",
        contents=[{
            "parts": [
                {"text": prompt},
                {"file_data": {"file_uri": youtube_url, "mime_type": "video/mp4"}},
            ]
        }],
    )
    return response.text.strip()


def _analyze_sync(video_id: str, question: str) -> dict:
    """Run full analysis pipeline synchronously."""
    subtitle_text = _get_subtitle_text(video_id)
    has_subtitle = subtitle_text is not None

    try:
        if has_subtitle:
            logger.info(f"[agent] analyzing {video_id} with subtitle ({len(subtitle_text)} chars)")
            analysis = _analyze_with_subtitle(video_id, subtitle_text, question)
        else:
            logger.info(f"[agent] analyzing {video_id} with Gemini video (no subtitle)")
            analysis = _analyze_with_video(video_id, question)
    except Exception as e:
        logger.error(f"[agent] analysis failed for {video_id}: {e}")
        if has_subtitle and "file_data" not in str(e):
            raise
        try:
            analysis = _analyze_with_video(video_id, question)
            has_subtitle = False
        except Exception as e2:
            raise RuntimeError(f"Both analysis methods failed: {e} / {e2}") from e2

    return {
        "videoId": video_id,
        "analysis": analysis,
        "method": "subtitle" if has_subtitle else "video",
        "url": f"https://www.youtube.com/watch?v={video_id}",
    }


@router.post("/analyze-video")
async def analyze_video(req: AnalyzeRequest):
    """Analyze a YouTube video. Subtitle-first, fallback to Gemini video."""
    if not GOOGLE_API_KEY:
        raise HTTPException(500, "Gemini API key not configured")

    video_id = _extract_video_id(req.video_url)
    if not video_id:
        raise HTTPException(400, f"Cannot extract video ID from: {req.video_url}")

    loop = asyncio.get_running_loop()
    try:
        result = await loop.run_in_executor(_executor, _analyze_sync, video_id, req.question)
        return result
    except Exception as e:
        logger.error(f"[agent] analyze failed: {e}")
        raise HTTPException(500, f"Video analysis failed: {str(e)}")
