from __future__ import annotations

import html
import re

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel, Field, field_validator
from typing import Literal

from lib import db

router = APIRouter(tags=["topics"])

_SAFE_NAME_RE = re.compile(r"^[\w\u4e00-\u9fff\u3000-\u303f\s\-·.,!?！？，。、：:()（）\[\]【】]+$")


class CreateTopicBody(BaseModel):
    name: str = Field(..., min_length=1, max_length=200)
    platforms: list[Literal["bilibili", "youtube"]] = Field(..., min_length=1)
    maxCreators: int = Field(default=10, ge=1, le=100)
    maxVideosPerCreator: int = Field(default=0, ge=0, le=500)

    @field_validator("name")
    @classmethod
    def sanitize_name(cls, v: str) -> str:
        v = v.strip()
        if not v:
            raise ValueError("名称不能为空")
        # HTML entity escape to prevent stored XSS
        v = html.escape(v, quote=True)
        if len(v) > 200:
            raise ValueError("名称过长（最多200字符）")
        return v


@router.post("/topics")
async def create_topic(body: CreateTopicBody, force: bool = Query(False)):
    if not force:
        existing = await db.find_topic_by_exact_name(body.name.strip())
        if existing:
            return {
                "conflict": True,
                "existingTopic": existing,
            }

    topic = await db.insert_topic(
        body.name,
        body.platforms,
        max_creators=body.maxCreators,
        max_videos_per_creator=body.maxVideosPerCreator,
    )
    return topic


@router.get("/topics")
async def list_topics():
    return await db.get_topics()


@router.get("/topics/{topic_id}")
async def get_topic(topic_id: str):
    topic = await db.get_topic(topic_id)
    if not topic:
        raise HTTPException(404, "Topic not found")
    return topic


@router.delete("/topics/{topic_id}")
async def delete_topic(topic_id: str):
    ok = await db.delete_topic(topic_id)
    if not ok:
        raise HTTPException(404, "Topic not found")
    return {"ok": True}
