"""Transcribe YouTube videos directly via Gemini API (no download needed)."""
from __future__ import annotations

import asyncio
import json
import re
from concurrent.futures import ThreadPoolExecutor

from loguru import logger

from lib.config import GOOGLE_API_KEY

_executor = ThreadPoolExecutor(max_workers=1)

TRANSCRIPT_PROMPT = """请将这个视频的语音内容完整转录为文字。

输出要求（严格遵守）：
1. 以 JSON 数组格式输出，每个元素包含 start（开始秒数）、end（结束秒数）、text（文字内容）
2. 每 15-30 秒为一个分段
3. 只输出 JSON 数组，不要输出其他任何文字
4. 如果视频没有语音内容，输出空数组 []

输出示例：
[{"start": 0, "end": 15.5, "text": "大家好，欢迎来到今天的节目"}, {"start": 15.5, "end": 32.0, "text": "今天我们要讨论的话题是..."}]"""


async def transcribe_youtube_via_gemini(video_id: str) -> list[dict] | None:
    """Use Gemini to transcribe a YouTube video directly from URL.

    Returns list of {start, end, text} segments or None on failure.
    """
    if not GOOGLE_API_KEY:
        return None

    loop = asyncio.get_running_loop()
    try:
        return await loop.run_in_executor(_executor, _call_gemini_sync, video_id)
    except Exception as e:
        logger.warning(f"Gemini transcription failed for {video_id}: {e}")
        return None


def _call_gemini_sync(video_id: str) -> list[dict] | None:
    try:
        from google import genai
    except ImportError:
        logger.warning("google-genai package not installed, Gemini transcription unavailable")
        return None

    client = genai.Client(api_key=GOOGLE_API_KEY)
    youtube_url = f"https://www.youtube.com/watch?v={video_id}"

    try:
        response = client.models.generate_content(
            model="gemini-2.5-flash",
            contents=[{
                "parts": [
                    {"text": TRANSCRIPT_PROMPT},
                    {"file_data": {"file_uri": youtube_url, "mime_type": "video/mp4"}},
                ]
            }],
        )

        raw = response.text.strip()
        logger.debug(f"Gemini raw response for {video_id}: {len(raw)} chars, starts with: {raw[:60]}")
        segments = _parse_segments(raw)

        if segments:
            logger.info(f"Gemini transcribed {video_id}: {len(segments)} segments")
            return segments

        logger.warning(f"Gemini returned no parseable segments for {video_id}")
        return None

    except Exception as e:
        logger.warning(f"Gemini API call failed for {video_id}: {e}")
        return None


def _parse_segments(raw: str) -> list[dict]:
    """Parse Gemini response into segment list, handling markdown fences."""
    text = raw.strip()
    fence_match = re.search(r"```(?:json)?\s*\n?(.*?)```", text, re.DOTALL)
    if fence_match:
        text = fence_match.group(1).strip()

    try:
        data = json.loads(text)
    except json.JSONDecodeError:
        bracket_match = re.search(r"\[.*\]", text, re.DOTALL)
        if bracket_match:
            try:
                data = json.loads(bracket_match.group(0))
            except json.JSONDecodeError:
                return []
        else:
            return []

    if not isinstance(data, list):
        return []

    segments = []
    for item in data:
        if isinstance(item, dict) and "text" in item:
            segments.append({
                "start": round(float(item.get("start", 0)), 2),
                "end": round(float(item.get("end", 0)), 2),
                "text": str(item["text"]).strip(),
            })
    return segments
