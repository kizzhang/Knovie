import { fetchBackend } from "./backend";
import type { VideoListResponse } from "./types";

const DUMP_CHAR_THRESHOLD = 750_000;

interface KnowledgeItem {
  videoTitle: string;
  creatorName: string;
  platform: string;
  platformVideoId: string;
  text: string;
}

interface TopicKnowledge {
  topicId: string;
  topicName: string;
  videoCount: number;
  totalChars: number;
  knowledge: KnowledgeItem[];
}

interface TranscriptSearchResult {
  videoId: string;
  videoTitle: string;
  creatorName: string;
  platform: string;
  platformVideoId: string;
  snippet: string;
  score: number;
}

// ── Knowledge fetching ──────────────────────────────────────────────

export async function getTopicKnowledge(topicId: string): Promise<TopicKnowledge | null> {
  try {
    return await fetchBackend<TopicKnowledge>(`/api/topics/${topicId}/knowledge`);
  } catch {
    return null;
  }
}

export async function searchTranscripts(query: string, topicId?: string) {
  const params = new URLSearchParams({ q: query });
  if (topicId) params.set("topicId", topicId);
  const data = await fetchBackend<{ results: TranscriptSearchResult[] }>(`/api/search/transcripts?${params}`);
  return data.results;
}

export async function getVideoTranscript(videoId: string) {
  return fetchBackend(`/api/videos/${videoId}/transcript`);
}

export async function webSearch(query: string) {
  const serperKey = process.env.SERPER_API_KEY;
  if (serperKey) {
    const res = await fetch("https://google.serper.dev/search", {
      method: "POST",
      headers: {
        "X-API-KEY": serperKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ q: query, gl: "cn", hl: "zh-cn", num: 5 }),
    });
    const data = await res.json();
    return (data.organic || []).map((r: { title: string; snippet: string; link: string }) => ({
      title: r.title,
      snippet: r.snippet,
      url: r.link,
    }));
  }

  return [{ title: "Web search unavailable", snippet: "No search API key configured", url: "" }];
}

export async function getTopicInfo(topicId: string) {
  try {
    return await fetchBackend(`/api/topics/${topicId}`);
  } catch {
    return null;
  }
}

// ── Kept for backward compat (search mode) ──────────────────────────

export async function searchKnowledgeBase(query: string, topicId?: string) {
  const params = new URLSearchParams({ search: query, hasTranscript: "true", pageSize: "10" });
  if (topicId) params.set("topicId", topicId);

  const data = await fetchBackend<VideoListResponse>(`/api/videos?${params}`);
  return data.videos.map((v) => ({
    id: v.id,
    title: v.title,
    creatorName: v.creatorName,
    platform: v.platform,
    platformVideoId: v.platformVideoId,
    duration: v.duration,
    viewCount: v.viewCount,
    hasTranscript: v.hasTranscript,
  }));
}

// ── System prompts ──────────────────────────────────────────────────

const CITATION_FORMAT = `## 引用格式要求
- 用中文回答，除非用户用其他语言提问
- 回答要详细、有结构，引用具体的视频内容
- **每个关键观点后面必须标注引用来源**，使用以下**精确格式**（不可省略 video:// 前缀）：
  某个观点的内容。 —— [视频标题 · 创作者](video://平台/视频平台ID?t=秒数)
- "平台"只能是 bilibili 或 youtube
- "视频平台ID"是该视频在原平台的 ID（在转录标题行中 平台/ID 给出）
- "秒数"是转录中对应段落的起始时间（整数秒），如不确定可省略 ?t= 部分
- **链接必须以 video:// 开头**，例如：
  [深度解析量化交易 · 张三](video://bilibili/BV1xxxx?t=120)
  [How AI Changes Business · John](video://youtube/dQw4w9WgXcQ?t=300)
- **在回答末尾，生成一个"参考来源"小节**，列出本次回答引用的 Top 3~5 个视频：
  ## 参考来源
  1. [视频标题](video://平台/视频平台ID) — 创作者
  2. ...`;

export function shouldDumpKnowledge(totalChars: number): boolean {
  return totalChars <= DUMP_CHAR_THRESHOLD;
}

export function buildDumpSystemPrompt(
  topicName: string,
  knowledge: KnowledgeItem[],
): string {
  const videoSections = knowledge.map((k) => {
    return `\n【视频】${k.videoTitle}\n【创作者】${k.creatorName}\n【引用ID】video://${k.platform}/${k.platformVideoId}\n---\n${k.text}`;
  }).join("\n\n");

  return `你是一个基于视频知识库的智能助手。下面是「${topicName}」主题下 ${knowledge.length} 个视频的完整转录内容。

**重要：你已经拥有该主题的全部转录文本，请直接基于下方内容回答用户问题，不需要调用搜索工具。只有在需要精确搜索某个关键词时才使用 searchTranscripts 工具。**

${CITATION_FORMAT}

## 工具（仅在必要时使用）
- searchTranscripts：在转录中精确搜索某个关键词（大多数情况不需要）
- webSearch：搜索互联网（知识库中没有相关信息时使用）

---
以下是「${topicName}」的全部 ${knowledge.length} 个视频转录：

${videoSections}`;
}

export function buildSearchSystemPrompt(
  topicName: string,
  videoCount: number,
  transcribedCount: number,
): string {
  return `你是一个基于视频知识库的智能助手。你的知识来源于从 B站 和 YouTube 爬取并转录的视频内容。

当前用户选择的主题：${topicName}
该主题下共有 ${videoCount} 个视频，其中 ${transcribedCount} 个已完成转录。
该主题内容较多，未全部加载。请通过工具搜索获取相关内容。

## 工具使用策略
- **优先使用 searchTranscripts 工具**搜索知识库中的转录片段（返回匹配的文字片段和视频信息）
- 如需某个视频的完整转录，使用 getVideoTranscript 工具
- 如果知识库中没有相关信息，使用 webSearch 工具搜索互联网

${CITATION_FORMAT}`;
}
