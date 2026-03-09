<p align="center">
  <img src="assets/banner.png" alt="Knovie Banner" width="100%" />
</p>

<p align="center">
  <strong>Turn videos into a searchable, AI-powered knowledge base.</strong>
</p>

<p align="center">
  <a href="#features">Features</a> ·
  <a href="#tech-stack">Tech Stack</a> ·
  <a href="#quick-start">Quick Start</a> ·
  <a href="#deployment">Deployment</a> ·
  <a href="#中文说明">中文说明</a> ·
  <a href="#license">License</a>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/Next.js-16-black?logo=next.js" alt="Next.js" />
  <img src="https://img.shields.io/badge/React-19-61DAFB?logo=react" alt="React" />
  <img src="https://img.shields.io/badge/FastAPI-async-009688?logo=fastapi" alt="FastAPI" />
  <img src="https://img.shields.io/badge/Gemini-2.5_Flash-4285F4?logo=google" alt="Gemini" />
  <img src="https://img.shields.io/badge/License-MIT-green" alt="MIT License" />
</p>

---

## What is Knovie?

**Knovie** (知频) collects videos from Bilibili and YouTube by topic keyword, transcribes them with AI, and lets you search through transcripts or ask an AI questions — with every answer traceable back to the original video clip.

## Features

- **Topic-based collection** — Enter a keyword, auto-collect videos from Bilibili / YouTube
- **Smart transcription** — Extracts platform subtitles first, falls back to Groq Whisper AI
- **AI Q&A** — Chat with your knowledge base powered by Google Gemini, with source citations
- **Full-text search** — Search through all transcribed content instantly
- **Import by link** — Import individual videos or entire creator channels by URL
- **Task center** — Track collection/transcription progress, cancel or retry tasks
- **Dashboard** — Overview stats, platform distribution, quick actions
- **Image caching** — Thumbnails and avatars cached locally for instant loading
- **Docker ready** — One-command deployment with PostgreSQL + Backend + Frontend

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | Next.js 16 (App Router) · React 19 · TypeScript · Tailwind CSS · shadcn/ui |
| AI | Vercel AI SDK · Google Gemini 2.5 Flash · Groq Whisper |
| Backend | Python FastAPI (async) · Pydantic v2 |
| Database | SQLite (dev) / PostgreSQL (prod) |
| Search | SQLite FTS5 / PostgreSQL tsvector + GIN |
| Deploy | Docker Compose · Vercel · Railway |

## Quick Start

### Prerequisites

- Node.js 20+, pnpm 9+
- Python 3.11+
- (Optional) Docker

### 1. Install dependencies

```bash
# Frontend
pnpm install

# Backend
cd backend
python -m venv ../venv
source ../venv/bin/activate  # Windows: ..\venv\Scripts\activate
pip install -r requirements.txt
```

### 2. Configure environment

```bash
cp .env.example .env.local
```

**Required:**

| Variable | Description | How to get |
|----------|-------------|------------|
| `GOOGLE_GENERATIVE_AI_API_KEY` | Gemini AI model | [Google AI Studio](https://aistudio.google.com/apikey) (free) |
| `GROQ_API_KEY` | Speech transcription | [Groq Console](https://console.groq.com) (free) |

**Optional:**

| Variable | Description | How to get |
|----------|-------------|------------|
| `BILIBILI_SESSDATA` | Bilibili cookie for higher quota | Browser DevTools |
| `SERPER_API_KEY` | Web search for AI chat | [serper.dev](https://serper.dev) (free 2500/mo) |

### 3. Start services

```bash
# Terminal 1: Backend
cd backend
uvicorn main:app --host 0.0.0.0 --port 8000 --reload

# Terminal 2: Frontend
pnpm dev --port 3000
```

Open http://localhost:3000.

### 4. Docker (one command)

```bash
docker compose up -d
```

Starts PostgreSQL + Backend + Frontend automatically.

## Deployment

<details>
<summary><strong>Vercel + Railway</strong></summary>

**Frontend → Vercel**
1. Connect repo to [Vercel](https://vercel.com)
2. Set env vars: `GOOGLE_GENERATIVE_AI_API_KEY`, `BACKEND_URL`
3. Push to deploy

**Backend → Railway**
1. Create [Railway](https://railway.app) project, select `backend/` directory
2. Set env vars: `DB_TYPE=postgres`, `DATABASE_URL`, `GROQ_API_KEY`, `ALLOWED_ORIGINS`
3. Set Vercel's `BACKEND_URL` to Railway's URL

**Database → Supabase / Railway PostgreSQL**
- Init with `backend/migrations/001_init.sql`

</details>

## Project Structure

```
knovie/
├── app/                        # Next.js pages
│   ├── page.tsx                #   Dashboard
│   ├── collect/page.tsx        #   Collection (keyword / link import)
│   ├── explore/page.tsx        #   Browse & search
│   ├── chat/page.tsx           #   AI Q&A
│   ├── tasks/page.tsx          #   Task center
│   ├── settings/page.tsx       #   Settings & health check
│   └── api/chat/route.ts       #   AI chat API (Vercel AI SDK)
├── components/                 # UI components
│   ├── layout/                 #   Sidebar, top bar, app shell
│   └── ui/                     #   shadcn/ui base components
├── lib/                        # Frontend utilities
├── backend/                    # Python FastAPI backend
│   ├── main.py                 #   Entry point
│   ├── routers/                #   API routes
│   ├── handlers/               #   Bilibili / YouTube scrapers
│   ├── services/               #   Transcription services
│   ├── lib/                    #   Database & config
│   └── migrations/             #   DB migration scripts
├── Dockerfile                  # Frontend container (multi-stage)
├── docker-compose.yml          # 3-service orchestration
└── .env.example                # Environment variable template
```

## Security

- No hardcoded secrets in source code
- `.env.local` excluded via `.gitignore`
- CORS restricted to configured origins only
- Global exception handler prevents stack trace leaks
- Optional IP rate limiting
- Database files and image cache excluded from git

---

<a id="中文说明"></a>

## 中文说明

### Knovie · 知频

**把 B站和 YouTube 的视频变成可搜索、可问答的知识库。**

输入一个主题关键词，Knovie 自动从 B站/YouTube 采集相关视频、提取或 AI 转录字幕，然后你可以全文搜索内容、让 AI 回答问题——所有答案都基于真实视频片段，可溯源。

### 核心功能

- **主题采集** — 输入关键词，自动从 B站 / YouTube 搜索并采集视频，支持配置采集规模
- **智能转录** — 优先提取平台字幕（零成本），无字幕时调用 Groq Whisper AI 语音识别
- **AI 问答** — 基于知识库内容的 AI 对话（Google Gemini），回答带来源引用
- **全文搜索** — 搜索全部转录内容，按平台和转录状态筛选
- **链接导入** — 通过视频或创作者链接直接导入
- **任务中心** — 采集/转录任务历史、实时进度、取消和重试
- **仪表盘** — 数据概览、平台分布、快捷操作
- **图片缓存** — 缩略图和头像本地缓存，秒级加载
- **Docker 部署** — 一键启动 PostgreSQL + 后端 + 前端

### 快速开始

```bash
# 安装前端依赖
pnpm install

# 安装后端依赖
cd backend
python -m venv ../venv
..\venv\Scripts\activate        # macOS/Linux: source ../venv/bin/activate
pip install -r requirements.txt

# 配置环境变量
cd ..
cp .env.example .env.local      # 填入 Gemini 和 Groq API Key

# 启动后端
cd backend
uvicorn main:app --host 0.0.0.0 --port 8000 --reload

# 启动前端（另一个终端）
pnpm dev --port 3000
```

打开 http://localhost:3000 即可使用。

### Docker 一键部署

```bash
docker compose up -d
```

### 环境变量

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `GOOGLE_GENERATIVE_AI_API_KEY` | — | Gemini API Key（必填）[获取](https://aistudio.google.com/apikey) |
| `GROQ_API_KEY` | — | 语音转录（必填）[获取](https://console.groq.com) |
| `BACKEND_URL` | `http://localhost:8000` | 后端地址 |
| `DB_TYPE` | `sqlite` | `sqlite`（开发）/ `postgres`（生产） |
| `DATABASE_URL` | — | PostgreSQL 连接串 |
| `BILIBILI_SESSDATA` | — | B站 Cookie（可选） |
| `SERPER_API_KEY` | — | 联网搜索（可选）[获取](https://serper.dev) |
| `ALLOWED_ORIGINS` | `localhost:3000,...` | CORS 允许的域名 |
| `RATE_LIMIT_ENABLED` | `false` | 启用 IP 速率限制 |
| `IMAGE_CACHE_DIR` | `backend/cache/images` | 图片缓存目录 |
| `SUBTITLE_CACHE_DIR` | `backend/cache/subtitles` | 原始字幕缓存目录 |
| `AUDIO_CACHE_DIR` | `backend/cache/audio` | 原始音频缓存目录 |

---

## License

[MIT](LICENSE)
