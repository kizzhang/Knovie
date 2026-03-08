from __future__ import annotations

import os
from pathlib import Path

from dotenv import load_dotenv

_env_path = Path(__file__).resolve().parents[2] / ".env.local"
if _env_path.exists():
    load_dotenv(_env_path)

DB_TYPE = os.getenv("DB_TYPE", "sqlite")  # "sqlite" | "postgres"
DB_PATH = os.getenv("DB_PATH", str(Path(__file__).resolve().parents[1] / "knowledge.db"))
DATABASE_URL = os.getenv("DATABASE_URL", "")
GROQ_API_KEY = os.getenv("GROQ_API_KEY", "")
QWEN_API_KEY = os.getenv("QWEN_API_KEY", "")
BILIBILI_SESSDATA = os.getenv("BILIBILI_SESSDATA", "")
SERPER_API_KEY = os.getenv("SERPER_API_KEY", "")
