"""Settings API — read/write .env.local configuration from the UI.

SECURITY: This API is disabled by default. Set SETTINGS_UI_ENABLED=true in your
environment to enable it. Only enable in local development — NEVER in production.
"""
from __future__ import annotations

import os
import re
from pathlib import Path
from typing import Any

from fastapi import APIRouter, HTTPException
from loguru import logger
from pydantic import BaseModel

router = APIRouter(tags=["settings"])

_ENV_PATH = Path(__file__).resolve().parents[2] / ".env.local"

def _guard():
    """Block access when the settings UI is not explicitly enabled."""
    if os.getenv("SETTINGS_UI_ENABLED", "").lower() not in ("true", "1", "yes"):
        raise HTTPException(
            status_code=403,
            detail="设置界面未启用。本地开发请在环境变量中设置 SETTINGS_UI_ENABLED=true",
        )

SETTINGS_SCHEMA: list[dict[str, Any]] = [
    {
        "key": "GOOGLE_GENERATIVE_AI_API_KEY",
        "label": "Gemini API Key",
        "description": "Google AI Studio API Key，用于 AI 问答和 YouTube 视频直接转录",
        "link": "https://aistudio.google.com/apikey",
        "linkLabel": "获取 API Key",
        "secret": True,
        "required": True,
        "group": "AI 模型",
    },
    {
        "key": "GROQ_API_KEY",
        "label": "Groq API Key",
        "description": "Groq Whisper 语音转录，作为字幕不可用时的后备",
        "link": "https://console.groq.com/keys",
        "linkLabel": "获取 API Key",
        "secret": True,
        "required": False,
        "group": "转录服务",
    },
    {
        "key": "SERPER_API_KEY",
        "label": "Serper API Key",
        "description": "让 AI 能搜索互联网获取最新信息（免费 2500 次/月）",
        "link": "https://serper.dev/signup",
        "linkLabel": "获取 API Key",
        "secret": True,
        "required": False,
        "group": "搜索服务",
    },
    {
        "key": "BILIBILI_SESSDATA",
        "label": "B站 SESSDATA",
        "description": "B站登录 Cookie，提高采集额度（浏览器 F12 → Application → Cookies）",
        "secret": True,
        "required": False,
        "group": "平台凭据",
    },
    {
        "key": "BACKEND_URL",
        "label": "后端地址",
        "description": "Python 后端服务的访问地址",
        "secret": False,
        "required": False,
        "default": "http://localhost:8000",
        "group": "基础配置",
    },
    {
        "key": "DB_TYPE",
        "label": "数据库类型",
        "description": "sqlite（开发）或 postgres（生产）",
        "secret": False,
        "required": False,
        "default": "sqlite",
        "group": "基础配置",
    },
    {
        "key": "DATABASE_URL",
        "label": "PostgreSQL 连接串",
        "description": "生产环境使用 PostgreSQL 时填写",
        "secret": True,
        "required": False,
        "group": "基础配置",
    },
    {
        "key": "ALLOWED_ORIGINS",
        "label": "CORS 允许域名",
        "description": "前端域名，多个用逗号分隔",
        "secret": False,
        "required": False,
        "default": "http://localhost:3000,http://localhost:3003",
        "group": "基础配置",
    },
]


def _mask(value: str) -> str:
    """Mask a secret value, showing only first 4 and last 4 characters."""
    if len(value) <= 10:
        return "*" * len(value)
    return value[:4] + "*" * (len(value) - 8) + value[-4:]


def _read_env() -> dict[str, str]:
    """Parse .env.local into a dict, ignoring comments and blank lines."""
    result: dict[str, str] = {}
    if not _ENV_PATH.exists():
        return result
    for line in _ENV_PATH.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#"):
            continue
        m = re.match(r"^([A-Za-z_][A-Za-z0-9_]*)=(.*)", line)
        if m:
            result[m.group(1)] = m.group(2).strip()
    return result


def _write_env(updates: dict[str, str]) -> None:
    """Update .env.local, preserving comments and structure."""
    lines: list[str] = []
    if _ENV_PATH.exists():
        lines = _ENV_PATH.read_text(encoding="utf-8").splitlines()

    updated_keys: set[str] = set()

    new_lines: list[str] = []
    for line in lines:
        stripped = line.strip()
        if stripped and not stripped.startswith("#"):
            m = re.match(r"^([A-Za-z_][A-Za-z0-9_]*)=(.*)", stripped)
            if m and m.group(1) in updates:
                key = m.group(1)
                new_lines.append(f"{key}={updates[key]}")
                updated_keys.add(key)
                continue
        new_lines.append(line)

    for key, value in updates.items():
        if key not in updated_keys:
            new_lines.append(f"{key}={value}")

    _ENV_PATH.write_text("\n".join(new_lines) + "\n", encoding="utf-8")


@router.get("/settings")
async def get_settings():
    """Return current settings with secrets masked."""
    _guard()
    env = _read_env()
    items = []
    for s in SETTINGS_SCHEMA:
        raw = env.get(s["key"], "")
        items.append({
            **s,
            "value": _mask(raw) if (s["secret"] and raw) else raw,
            "isSet": bool(raw),
        })
    return {"items": items}


class SettingsUpdate(BaseModel):
    settings: dict[str, str]


@router.put("/settings")
async def update_settings(body: SettingsUpdate):
    """Save settings to .env.local. Only non-empty values are written."""
    _guard()
    current = _read_env()
    valid_keys = {s["key"] for s in SETTINGS_SCHEMA}
    updates: dict[str, str] = {}

    for key, value in body.settings.items():
        if key not in valid_keys:
            continue
        if re.match(r"^[A-Za-z0-9*]+$", value) and "*" in value:
            continue
        updates[key] = value

    if updates:
        merged = {**current, **updates}
        clean = {k: v for k, v in merged.items() if v}
        _write_env(clean)
        logger.info(f"Settings updated: {list(updates.keys())}")

        _reload_runtime_config(updates)

    return {"ok": True, "updated": list(updates.keys())}


def _reload_runtime_config(updates: dict[str, str]) -> None:
    """Push updated values into os.environ and reload lib.config."""
    for key, value in updates.items():
        os.environ[key] = value

    try:
        import importlib
        import lib.config as cfg_module
        importlib.reload(cfg_module)
    except Exception as e:
        logger.warning(f"Failed to reload config module: {e}")
