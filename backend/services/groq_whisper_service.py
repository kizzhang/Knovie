from __future__ import annotations

import os
import tempfile
from pathlib import Path

import httpx
from loguru import logger

from lib.config import GROQ_API_KEY

GROQ_API_URL = "https://api.groq.com/openai/v1/audio/transcriptions"
MODEL = "whisper-large-v3-turbo"
MAX_FILE_SIZE = 24 * 1024 * 1024  # 24MB


async def transcribe_audio(file_path: str, language: str = "zh") -> list[dict]:
    """Transcribe audio using Groq Whisper API. Returns list of {start, end, text} segments."""
    if not GROQ_API_KEY:
        raise RuntimeError("GROQ_API_KEY not configured")

    file_size = os.path.getsize(file_path)
    if file_size > MAX_FILE_SIZE:
        logger.warning(f"File {file_path} is {file_size / 1024 / 1024:.1f}MB, may need chunking")

    headers = {"Authorization": f"Bearer {GROQ_API_KEY}"}

    async with httpx.AsyncClient(timeout=120) as client:
        for attempt in range(3):
            try:
                with open(file_path, "rb") as f:
                    files = {"file": (Path(file_path).name, f, "audio/mpeg")}
                    data = {
                        "model": MODEL,
                        "language": language,
                        "response_format": "verbose_json",
                        "timestamp_granularities[]": "segment",
                    }
                    resp = await client.post(GROQ_API_URL, headers=headers, files=files, data=data)

                if resp.status_code == 200:
                    result = resp.json()
                    segments = []
                    for seg in result.get("segments", []):
                        segments.append({
                            "start": round(seg.get("start", 0), 2),
                            "end": round(seg.get("end", 0), 2),
                            "text": seg.get("text", "").strip(),
                        })
                    if not segments and result.get("text"):
                        segments.append({"start": 0, "end": 0, "text": result["text"]})
                    return segments

                if resp.status_code == 429:
                    wait = 2 ** (attempt + 1)
                    logger.warning(f"Rate limited by Groq, retrying in {wait}s")
                    import asyncio
                    await asyncio.sleep(wait)
                    continue

                logger.error(f"Groq API error {resp.status_code}: {resp.text}")
                raise RuntimeError(f"Groq API error: {resp.status_code}")

            except httpx.TimeoutException:
                if attempt < 2:
                    logger.warning(f"Groq request timeout, attempt {attempt + 1}")
                    continue
                raise

    raise RuntimeError("Groq transcription failed after retries")
