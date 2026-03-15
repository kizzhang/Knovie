from __future__ import annotations

import os
import time
from collections import defaultdict
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from loguru import logger

from lib.db import get_db, close_db
from routers import topics, videos, collect, stats, creators, proxy, settings, agent


@asynccontextmanager
async def lifespan(app: FastAPI):
    logger.info("Starting Knovie backend...")
    await get_db()
    yield
    logger.info("Shutting down...")
    await close_db()


app = FastAPI(title="Knovie API", version="0.2.0", lifespan=lifespan)

ALLOWED_ORIGINS = os.getenv(
    "ALLOWED_ORIGINS",
    "http://localhost:3000,http://localhost:3003",
).split(",")

app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ── Global exception handler ──────────────────────────────────────

@app.exception_handler(Exception)
async def global_exception_handler(request: Request, exc: Exception):
    logger.exception(f"Unhandled error on {request.method} {request.url.path}")
    return JSONResponse(
        status_code=500,
        content={"detail": "服务器内部错误，请稍后重试"},
    )


# ── Optional rate limiter ─────────────────────────────────────────

RATE_LIMIT_ENABLED = os.getenv("RATE_LIMIT_ENABLED", "false").lower() == "true"
RATE_LIMIT_RPM = int(os.getenv("RATE_LIMIT_RPM", "120"))

_rate_buckets: dict[str, list[float]] = defaultdict(list)

if RATE_LIMIT_ENABLED:
    @app.middleware("http")
    async def rate_limit_middleware(request: Request, call_next):
        client_ip = request.client.host if request.client else "unknown"
        now = time.time()
        window = _rate_buckets[client_ip]
        window[:] = [t for t in window if now - t < 60]
        if len(window) >= RATE_LIMIT_RPM:
            return JSONResponse(
                status_code=429,
                content={"detail": "请求过于频繁，请稍后重试"},
            )
        window.append(now)
        return await call_next(request)


# ── Routers ───────────────────────────────────────────────────────

app.include_router(topics.router, prefix="/api")
app.include_router(videos.router, prefix="/api")
app.include_router(creators.router, prefix="/api")
app.include_router(collect.router, prefix="/api")
app.include_router(stats.router, prefix="/api")
app.include_router(settings.router, prefix="/api")
app.include_router(agent.router, prefix="/api")
app.include_router(proxy.router, prefix="/api")


@app.get("/health")
async def health():
    return {"status": "ok"}


if __name__ == "__main__":
    import uvicorn
    port = int(os.getenv("PORT", "8000"))
    uvicorn.run("main:app", host="0.0.0.0", port=port, reload=os.getenv("ENV") != "production")
