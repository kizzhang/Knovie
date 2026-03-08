import { fetchBackend } from "./backend";
import type { DashboardStats, VideoListResponse } from "./types";

const BACKEND_URL = process.env.BACKEND_URL || "http://localhost:8000";

export function buildSystemPrompt(topicName: string, videoCount: number, transcribedCount: number) {
  return `你是一个基于视频知识库的智能助手。你的知识来源于从 B站 和 YouTube 爬取并转录的视频内容。

当前用户选择的主题：${topicName}
该主题下共有 ${videoCount} 个视频，其中 ${transcribedCount} 个已完成转录。

## 工具使用策略
- 优先使用 searchKnowledgeBase 工具在知识库中搜索相关内容
- 如果需要某个视频的完整内容，使用 getVideoTranscript 工具
- 如果知识库中没有相关信息，使用 webSearch 工具搜索互联网

## 回答格式要求
- 用中文回答，除非用户用其他语言提问
- 回答要详细、有结构，引用具体的视频内容
- **每个关键观点后面必须标注引用来源**，格式为：在观点末尾用 markdown 链接格式引用，例如：
  某个观点的内容。 —— [视频标题 · 创作者](video://平台/视频平台ID?t=秒数)
  其中"平台"为 bilibili 或 youtube，"视频平台ID"为该视频在原平台的 ID，"秒数"是转录中对应段落的起始时间（整数秒）。
- 如果无法确定精确时间戳，可以省略 ?t= 参数
- **在回答末尾，生成一个"参考来源"小节**，列出本次回答引用的 Top 3~5 个视频，格式：
  ## 参考来源
  1. [视频标题](video://平台/视频平台ID) — 创作者
  2. ...

## 示例
用户问："XX 领域有哪些关键趋势？"
你的回答：
"根据知识库中的视频内容，XX 领域有以下关键趋势：

1. **趋势一**：详细解释... —— [深度解析XX](video://bilibili/BV1xxxx?t=120)
2. **趋势二**：详细解释... —— [YY的未来](video://youtube/dQw4w9WgXcQ?t=300)

## 参考来源
1. [深度解析XX](video://bilibili/BV1xxxx) — 张三
2. [YY的未来](video://youtube/dQw4w9WgXcQ) — John Doe"`;
}

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
