from __future__ import annotations

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel

from lib import db

router = APIRouter(tags=["topics"])


class CreateTopicBody(BaseModel):
    name: str
    platforms: list[str]
    maxCreators: int = 10
    maxVideosPerCreator: int = 0


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
