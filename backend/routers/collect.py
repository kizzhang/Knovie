from __future__ import annotations

import asyncio
import re
import sys

from fastapi import APIRouter, HTTPException
from loguru import logger
from pydantic import BaseModel

from lib import db
from handlers.bilibili_handler import scrape_bilibili
from handlers.youtube_handler import scrape_youtube
from services.transcribe_service import transcribe_topic_videos
from routers.proxy import precache_images

router = APIRouter(tags=["collect"])

_running_tasks: dict[str, asyncio.Task] = {}


class CollectBody(BaseModel):
    topicId: str
    platforms: list[str] | None = None


@router.post("/collect")
async def start_collect(body: CollectBody):
    topic = await db.get_topic(body.topicId)
    if not topic:
        raise HTTPException(404, "Topic not found")

    for tid, t in _running_tasks.items():
        if not t.done():
            existing = await db.get_task(tid)
            if existing and existing["topicId"] == body.topicId:
                raise HTTPException(409, "A collection task is already running for this topic")

    if body.platforms and set(body.platforms) != set(topic["platforms"]):
        await db.update_topic_platforms(body.topicId, body.platforms)
        platforms = body.platforms
    else:
        platforms = topic["platforms"]

    task_id = await db.insert_task(body.topicId, "scrape")
    asyncio_task = asyncio.create_task(
        _run_collect(task_id, body.topicId, platforms)
    )
    _running_tasks[task_id] = asyncio_task
    return {"taskId": task_id, "status": "pending"}


@router.get("/tasks")
async def list_tasks(limit: int = 20):
    return await db.get_recent_tasks(min(limit, 50))


@router.post("/collect/{task_id}/cancel")
async def cancel_task(task_id: str):
    task = await db.get_task(task_id)
    if not task:
        raise HTTPException(404, "Task not found")
    if task["status"] not in ("pending", "running"):
        raise HTTPException(400, "Task is not cancellable")

    asyncio_task = _running_tasks.get(task_id)
    if asyncio_task and not asyncio_task.done():
        asyncio_task.cancel()

    await db.update_task(task_id, status="failed", message="用户手动取消", error_msg="canceled")
    topic_id = task["topicId"]
    try:
        await db.update_topic_status(topic_id, "error")
    except Exception:
        pass
    _running_tasks.pop(task_id, None)
    return {"ok": True}


@router.get("/collect/{task_id}/status")
async def get_collect_status(task_id: str):
    task = await db.get_task(task_id)
    if not task:
        raise HTTPException(404, "Task not found")
    return task


class TranscribeBody(BaseModel):
    topicId: str


@router.post("/transcribe")
async def start_transcribe(body: TranscribeBody):
    topic = await db.get_topic(body.topicId)
    if not topic:
        raise HTTPException(404, "Topic not found")

    for tid, t in _running_tasks.items():
        if not t.done():
            existing = await db.get_task(tid)
            if existing and existing["topicId"] == body.topicId:
                raise HTTPException(409, "该主题已有任务正在运行")

    task_id = await db.insert_task(body.topicId, "transcribe")
    asyncio_task = asyncio.create_task(
        _run_transcribe(task_id, body.topicId)
    )
    _running_tasks[task_id] = asyncio_task
    return {"taskId": task_id, "status": "pending"}


async def _run_transcribe(task_id: str, topic_id: str):
    try:
        await db.update_task(task_id, status="running", progress=0.0, message="开始转录未完成的视频...")
        await db.update_topic_status(topic_id, "transcribing")

        await transcribe_topic_videos(topic_id, task_id)

        await db.update_task(task_id, status="done", progress=1.0, message="转录完成")
        await db.update_topic_status(topic_id, "done")
        logger.info(f"Transcribe task {task_id} completed")
    except Exception as e:
        logger.exception(f"Transcribe task {task_id} failed")
        err_hint = str(e)[:500]
        try:
            await db.update_task(task_id, status="failed", error_msg=err_hint, message=f"转录失败: {err_hint}")
            await db.update_topic_status(topic_id, "error")
        except Exception:
            logger.exception("Failed to update task/topic status after error")
    finally:
        _running_tasks.pop(task_id, None)


async def _run_collect(task_id: str, topic_id: str, platforms: list[str]):
    try:
        await db.update_task(task_id, status="running", progress=0.0, message="开始采集...")
        await db.update_topic_status(topic_id, "collecting")

        topic = await db.get_topic(topic_id)
        topic_name = topic["name"] if topic else ""
        max_creators = topic.get("maxCreators", 10) if topic else 10
        max_videos = topic.get("maxVideosPerCreator", 0) if topic else 0

        platform_label = {"bilibili": "B站", "youtube": "YouTube"}
        total_saved = 0
        total_creators = 0
        scrape_errors: list[str] = []

        for idx, platform in enumerate(platforms):
            label = platform_label.get(platform, platform)
            progress = 0.1 + 0.5 * (idx / max(len(platforms), 1))
            await db.update_task(task_id, progress=round(progress, 2), message=f"阶段 1/{2}：正在从 {label} 采集视频...")

            try:
                if platform == "bilibili":
                    stats = await scrape_bilibili(topic_id, topic_name, max_creators=max_creators, max_videos_per_creator=max_videos)
                elif platform == "youtube":
                    stats = await scrape_youtube(topic_id, topic_name, max_creators=max_creators, max_videos_per_creator=max_videos)
                else:
                    stats = {"saved": 0, "creators": 0}

                if stats:
                    total_saved += stats.get("saved", 0)
                    total_creators += stats.get("creators", 0)

                await db.update_task(
                    task_id,
                    message=f"{label} 采集完成：{stats.get('saved', 0)} 个视频，{stats.get('creators', 0)} 位创作者",
                )
            except Exception as e:
                logger.error(f"Scrape {platform} failed: {e}")
                err_hint = _get_scrape_error_hint(platform, e)
                scrape_errors.append(f"{label}: {err_hint}")
                await db.update_task(task_id, message=f"{label} 采集失败: {err_hint}")

        scrape_summary = f"采集完成：共 {total_saved} 个视频，{total_creators} 位创作者"
        if scrape_errors:
            scrape_summary += f"（{len(scrape_errors)} 个平台部分失败）"

        # Pre-cache thumbnails and avatars in background
        try:
            await db.update_task(task_id, message=f"正在缓存图片... ({scrape_summary})")
            image_urls = await _collect_image_urls(topic_id)
            if image_urls:
                cached = await precache_images(image_urls)
                logger.info(f"Pre-cached {cached} new images for topic {topic_id}")
        except Exception as e:
            logger.warning(f"Image pre-cache failed (non-fatal): {e}")

        await db.update_task(task_id, progress=0.6, message=f"阶段 2/2：开始转录... ({scrape_summary})")
        await db.update_topic_status(topic_id, "transcribing")

        await transcribe_topic_videos(topic_id, task_id)

        done_msg = f"全部完成 · {scrape_summary}"
        await db.update_task(task_id, status="done", progress=1.0, message=done_msg)
        await db.update_topic_status(topic_id, "done")
        logger.info(f"Collect task {task_id} completed")

    except Exception as e:
        logger.exception(f"Collect task {task_id} failed")
        err_hint = str(e)[:500]
        try:
            await db.update_task(task_id, status="failed", error_msg=err_hint, message=f"采集失败: {err_hint}")
            await db.update_topic_status(topic_id, "error")
        except Exception:
            logger.exception("Failed to update task/topic status after error")
    finally:
        _running_tasks.pop(task_id, None)


def _get_scrape_error_hint(platform: str, error: Exception) -> str:
    msg = str(error).lower()
    if "not found" in msg or "not available" in msg:
        return "采集工具未安装或不可用，请检查服务端环境"
    if "timeout" in msg:
        return "请求超时，请检查网络连接"
    if "credential" in msg or "cookie" in msg or "login" in msg:
        return "认证信息无效或已过期，请更新配置"
    if "rate" in msg or "429" in msg:
        return "请求频率过高，请稍后重试"
    return str(error)[:200]


async def _collect_image_urls(topic_id: str) -> list[str]:
    """Gather all thumbnail and avatar URLs for a topic."""
    urls: list[str] = []
    try:
        video_result = await db.get_videos(topic_id=topic_id, page=1, page_size=9999)
        if isinstance(video_result, tuple):
            items, _ = video_result
        elif isinstance(video_result, dict):
            items = video_result.get("items", [])
        else:
            items = video_result
        for v in items:
            thumb = v.get("thumbnailUrl") or v.get("thumbnail_url")
            if thumb:
                urls.append(thumb)

        creators = await db.get_creators(topic_id=topic_id)
        if isinstance(creators, list):
            for c in creators:
                avatar = c.get("avatarUrl") or c.get("avatar_url")
                if avatar:
                    urls.append(avatar)
    except Exception as e:
        logger.warning(f"Failed to collect image URLs: {e}")
    return urls


# --------------- Import by URL ---------------

def _parse_video_url(url: str) -> tuple[str, str] | None:
    url = url.strip()
    m = re.search(r"bilibili\.com/video/(BV[\w]+)", url)
    if m:
        return ("bilibili", m.group(1))
    m = re.search(r"b23\.tv/([\w]+)", url)
    if m:
        return ("bilibili", m.group(1))
    m = re.search(r"(?:youtube\.com/watch\?.*v=|youtu\.be/)([\w\-]+)", url)
    if m:
        return ("youtube", m.group(1))
    return None


def _parse_creator_url(url: str) -> tuple[str, str] | None:
    """Extract (platform, creator_id) from a creator profile URL."""
    url = url.strip()
    m = re.search(r"space\.bilibili\.com/(\d+)", url)
    if m:
        return ("bilibili", m.group(1))
    m = re.search(r"bilibili\.com/space/(\d+)", url)
    if m:
        return ("bilibili", m.group(1))
    m = re.search(r"youtube\.com/(?:channel/|@)([\w\-]+)", url)
    if m:
        return ("youtube", m.group(1))
    return None


class ImportVideoBody(BaseModel):
    topicId: str
    url: str


@router.post("/import-video")
async def import_video_by_url(body: ImportVideoBody):
    topic = await db.get_topic(body.topicId)
    if not topic:
        raise HTTPException(404, "Topic not found")

    parsed = _parse_video_url(body.url)
    if not parsed:
        raise HTTPException(400, "无法识别的视频链接，请输入 B站 或 YouTube 视频链接")

    platform, video_id = parsed

    try:
        if platform == "bilibili":
            result = await _import_bilibili_video(body.topicId, video_id)
        else:
            result = await _import_youtube_video(body.topicId, video_id)

        # Pre-cache the imported video's thumbnail
        image_urls = await _collect_image_urls(body.topicId)
        asyncio.create_task(precache_images(image_urls))

        return result
    except Exception as e:
        logger.error(f"Import video by URL failed: {e}")
        raise HTTPException(500, f"导入失败: {str(e)[:300]}")


async def _import_bilibili_video(topic_id: str, bvid: str) -> dict:
    try:
        from bilibili_api import video as bvideo, Credential
        from lib.config import BILIBILI_SESSDATA
        cred = Credential(sessdata=BILIBILI_SESSDATA) if BILIBILI_SESSDATA else None
    except ImportError:
        raise RuntimeError("B站采集工具未安装")

    v = bvideo.Video(bvid=bvid, credential=cred)
    info = await v.get_info()

    owner = info.get("owner", {})
    mid = str(owner.get("mid", "unknown"))
    author = owner.get("name", "Unknown")
    avatar = owner.get("face", "")

    creator_id = await db.upsert_creator(
        platform="bilibili", platform_uid=mid, name=author,
        topic_id=topic_id, avatar_url=avatar,
    )

    stat = info.get("stat", {})
    video_db_id = await db.upsert_video(
        platform="bilibili", platform_video_id=bvid,
        title=info.get("title", ""), topic_id=topic_id,
        creator_id=creator_id, creator_name=author,
        description=info.get("desc", ""),
        thumbnail_url=info.get("pic", ""),
        duration=info.get("duration", 0),
        view_count=stat.get("view", 0),
        like_count=stat.get("like", 0),
    )

    return {
        "ok": True,
        "videoId": video_db_id,
        "title": info.get("title", ""),
        "creator": author,
        "platform": "bilibili",
    }


async def _import_youtube_video(topic_id: str, video_id: str) -> dict:
    import json
    import subprocess
    from concurrent.futures import ThreadPoolExecutor

    executor = ThreadPoolExecutor(max_workers=1)
    loop = asyncio.get_event_loop()

    def _fetch():
        cmd = [
            sys.executable, "-m", "yt_dlp", "--dump-json", "--no-download",
            f"https://www.youtube.com/watch?v={video_id}",
        ]
        result = subprocess.run(cmd, capture_output=True, text=True, timeout=30)
        if result.returncode != 0:
            raise RuntimeError(result.stderr[:300] or "yt-dlp failed")
        return json.loads(result.stdout)

    info = await loop.run_in_executor(executor, _fetch)

    ch_id = info.get("channel_id") or info.get("uploader_id") or "unknown"
    ch_name = info.get("channel") or info.get("uploader") or "Unknown"

    creator_id = await db.upsert_creator(
        platform="youtube", platform_uid=ch_id, name=ch_name,
        topic_id=topic_id,
    )

    video_db_id = await db.upsert_video(
        platform="youtube", platform_video_id=video_id,
        title=info.get("title", ""), topic_id=topic_id,
        creator_id=creator_id, creator_name=ch_name,
        description=info.get("description", "")[:500],
        thumbnail_url=info.get("thumbnail", ""),
        duration=info.get("duration", 0),
        view_count=info.get("view_count", 0),
        like_count=info.get("like_count", 0),
    )

    return {
        "ok": True,
        "videoId": video_db_id,
        "title": info.get("title", ""),
        "creator": ch_name,
        "platform": "youtube",
    }


# --------------- Import Creator by URL ---------------

class ImportCreatorBody(BaseModel):
    topicId: str
    url: str
    maxVideos: int = 30


@router.post("/import-creator")
async def import_creator_by_url(body: ImportCreatorBody):
    topic = await db.get_topic(body.topicId)
    if not topic:
        raise HTTPException(404, "Topic not found")

    parsed = _parse_creator_url(body.url)
    if not parsed:
        raise HTTPException(400, "无法识别的创作者链接，请输入 B站空间链接 或 YouTube 频道链接")

    platform, creator_uid = parsed
    max_videos = max(1, min(body.maxVideos, 200))

    try:
        if platform == "bilibili":
            result = await _import_bilibili_creator(body.topicId, creator_uid, max_videos)
        else:
            result = await _import_youtube_creator(body.topicId, creator_uid, max_videos)

        # Pre-cache new thumbnails and avatar
        image_urls = await _collect_image_urls(body.topicId)
        asyncio.create_task(precache_images(image_urls))

        return result
    except Exception as e:
        logger.error(f"Import creator by URL failed: {e}")
        raise HTTPException(500, f"导入失败: {str(e)[:300]}")


async def _import_bilibili_creator(topic_id: str, mid: str, max_videos: int) -> dict:
    try:
        from bilibili_api import user as buser, Credential
        from lib.config import BILIBILI_SESSDATA
        cred = Credential(sessdata=BILIBILI_SESSDATA) if BILIBILI_SESSDATA else None
    except ImportError:
        raise RuntimeError("B站采集工具未安装")

    u = buser.User(uid=int(mid), credential=cred)
    user_info = await u.get_user_info()

    uname = user_info.get("name", "Unknown")
    avatar = user_info.get("face", "")
    follower = user_info.get("fans", 0) or user_info.get("follower", 0)

    creator_id = await db.upsert_creator(
        platform="bilibili", platform_uid=mid, name=uname,
        topic_id=topic_id, avatar_url=avatar, follower_count=follower,
    )

    video_list = await u.get_videos(pn=1, ps=min(max_videos, 50))
    vlist = video_list.get("list", {}).get("vlist", [])

    saved = 0
    for v in vlist[:max_videos]:
        bvid = v.get("bvid", "")
        if not bvid:
            continue
        try:
            await db.upsert_video(
                platform="bilibili", platform_video_id=bvid,
                title=v.get("title", ""), topic_id=topic_id,
                creator_id=creator_id, creator_name=uname,
                description=v.get("description", ""),
                thumbnail_url=v.get("pic", ""),
                duration=v.get("length", 0) if isinstance(v.get("length"), int) else 0,
                view_count=v.get("play", 0) if isinstance(v.get("play"), int) else 0,
            )
            saved += 1
        except Exception as e:
            logger.warning(f"Failed to save video {bvid}: {e}")

    return {
        "ok": True,
        "creator": uname,
        "platform": "bilibili",
        "videoCount": saved,
    }


async def _import_youtube_creator(topic_id: str, channel_id: str, max_videos: int) -> dict:
    import json
    import subprocess
    from concurrent.futures import ThreadPoolExecutor

    executor = ThreadPoolExecutor(max_workers=1)
    loop = asyncio.get_event_loop()

    is_handle = not channel_id.startswith("UC")
    if is_handle:
        channel_url = f"https://www.youtube.com/@{channel_id}/videos"
    else:
        channel_url = f"https://www.youtube.com/channel/{channel_id}/videos"

    def _fetch():
        cmd = [
            sys.executable, "-m", "yt_dlp", "--flat-playlist", "--dump-json",
            "--no-warnings", "--no-check-certificates",
            "--playlist-end", str(max_videos),
            channel_url,
        ]
        result = subprocess.run(cmd, capture_output=True, text=True, timeout=120)
        entries = []
        for line in result.stdout.strip().split("\n"):
            if line.strip():
                try:
                    entries.append(json.loads(line))
                except json.JSONDecodeError:
                    pass
        return entries

    entries = await loop.run_in_executor(executor, _fetch)
    if not entries:
        raise RuntimeError("未能获取该频道的视频列表，请检查链接是否正确")

    first = entries[0]
    ch_name = first.get("channel") or first.get("uploader") or "Unknown"
    ch_uid = first.get("channel_id") or first.get("uploader_id") or channel_id

    creator_id = await db.upsert_creator(
        platform="youtube", platform_uid=ch_uid, name=ch_name,
        topic_id=topic_id,
    )

    saved = 0
    for entry in entries[:max_videos]:
        vid = entry.get("id", "")
        if not vid:
            continue
        try:
            await db.upsert_video(
                platform="youtube", platform_video_id=vid,
                title=entry.get("title", ""), topic_id=topic_id,
                creator_id=creator_id, creator_name=ch_name,
                description=entry.get("description", "")[:500] if entry.get("description") else "",
                thumbnail_url=entry.get("thumbnail", "") or "",
                duration=entry.get("duration") or 0,
                view_count=entry.get("view_count") or 0,
            )
            saved += 1
        except Exception as e:
            logger.warning(f"Failed to save YT video {vid}: {e}")

    return {
        "ok": True,
        "creator": ch_name,
        "platform": "youtube",
        "videoCount": saved,
    }
