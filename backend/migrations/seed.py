"""Seed script for local development.
Inserts sample data so the UI is not empty.

Usage:
  cd backend
  python -m migrations.seed
"""
from __future__ import annotations

import asyncio
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from lib.db import get_db, close_db, insert_topic, upsert_creator, upsert_video, insert_transcript


async def main():
    await get_db()

    topic = await insert_topic("AI 技术入门", ["bilibili", "youtube"])
    tid = topic["id"]
    print(f"Created topic: {tid}")

    c1 = await upsert_creator("bilibili", "12345", "AI科普小王", tid, avatar_url=None, follower_count=50000)
    c2 = await upsert_creator("youtube", "UCxyz", "TechExplained", tid, avatar_url=None, follower_count=120000)
    print(f"Created creators: {c1}, {c2}")

    v1 = await upsert_video(
        "bilibili", "BV1example01", "什么是大语言模型？5分钟搞懂LLM", tid, c1, "AI科普小王",
        description="通俗易懂介绍LLM原理", duration=300, view_count=85000, like_count=3200,
    )
    v2 = await upsert_video(
        "youtube", "dQw4w9WgXcQ", "Transformers Explained Simply", tid, c2, "TechExplained",
        description="A beginner-friendly explanation of the Transformer architecture", duration=480, view_count=200000, like_count=12000,
    )
    print(f"Created videos: {v1}, {v2}")

    await insert_transcript(v1, "subtitle", [
        {"start": 0, "end": 30, "text": "大家好，今天我们来聊一聊大语言模型。"},
        {"start": 30, "end": 60, "text": "LLM的核心是Transformer架构，它通过自注意力机制来理解文本。"},
        {"start": 60, "end": 120, "text": "训练过程需要海量数据和算力，但推理可以在普通设备上完成。"},
    ], "大家好，今天我们来聊一聊大语言模型。LLM的核心是Transformer架构，它通过自注意力机制来理解文本。训练过程需要海量数据和算力，但推理可以在普通设备上完成。")

    await insert_transcript(v2, "subtitle", [
        {"start": 0, "end": 20, "text": "Hello everyone, today we explain what Transformers are."},
        {"start": 20, "end": 50, "text": "The key innovation is the self-attention mechanism."},
        {"start": 50, "end": 90, "text": "It allows the model to look at all positions in the input simultaneously."},
    ], "Hello everyone, today we explain what Transformers are. The key innovation is the self-attention mechanism. It allows the model to look at all positions in the input simultaneously.")

    print("Seed data inserted successfully!")
    await close_db()


if __name__ == "__main__":
    asyncio.run(main())
