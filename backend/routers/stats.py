from __future__ import annotations

import shutil
import subprocess
import sys

from fastapi import APIRouter

from lib import db
from lib.config import GROQ_API_KEY, BILIBILI_SESSDATA, SERPER_API_KEY, GOOGLE_API_KEY

router = APIRouter(tags=["stats"])


@router.get("/stats")
async def get_stats():
    return await db.get_stats()


@router.get("/health")
async def health_check():
    checks = {}

    checks["backend"] = {"ok": True, "label": "后端服务"}

    try:
        await db.get_db()
        checks["database"] = {"ok": True, "label": "数据库"}
    except Exception as e:
        checks["database"] = {"ok": False, "label": "数据库", "hint": str(e)[:200]}

    checks["aiModel"] = {
        "ok": True,
        "label": "AI 模型（由前端配置）",
        "hint": "前端环境变量 GOOGLE_GENERATIVE_AI_API_KEY",
    }

    transcribe_methods = []
    if GOOGLE_API_KEY:
        transcribe_methods.append("Gemini（YouTube 直传）")
    if GROQ_API_KEY:
        transcribe_methods.append("Groq Whisper")
    checks["transcriptionService"] = {
        "ok": bool(GOOGLE_API_KEY or GROQ_API_KEY),
        "label": "语音转录服务",
        "hint": "、".join(transcribe_methods) + " 已配置" if transcribe_methods else "未配置（需要 Gemini API Key 或 Groq API Key）",
    }

    checks["searchService"] = {
        "ok": bool(SERPER_API_KEY),
        "label": "互联网搜索服务",
        "hint": "未配置" if not SERPER_API_KEY else "已配置",
    }

    yt_ok = shutil.which("yt-dlp") is not None
    if not yt_ok:
        try:
            subprocess.run([sys.executable, "-m", "yt_dlp", "--version"],
                           capture_output=True, timeout=5, check=True)
            yt_ok = True
        except Exception:
            yt_ok = False
    checks["videoDownloader"] = {
        "ok": yt_ok,
        "label": "视频下载工具",
        "hint": "未安装或不在 PATH 中" if not yt_ok else "已就绪",
    }

    try:
        from bilibili_api import search as _  # noqa: F401
        bili_ok = True
    except ImportError:
        bili_ok = False
    checks["bilibiliScraper"] = {
        "ok": bili_ok,
        "label": "B站采集模块",
        "hint": "采集模块未安装" if not bili_ok else ("已就绪" + ("（Cookie 已配置）" if BILIBILI_SESSDATA else "（Cookie 未配置，部分功能受限）")),
    }

    all_ok = all(c["ok"] for c in checks.values())
    return {"ok": all_ok, "checks": checks}
