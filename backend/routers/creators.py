from __future__ import annotations

from fastapi import APIRouter

from lib import db

router = APIRouter(tags=["creators"])


@router.get("/creators")
async def list_creators(topicId: str | None = None, search: str | None = None):
    return await db.get_creators(topic_id=topicId, search=search)
