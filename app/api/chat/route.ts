import { streamText, tool, convertToModelMessages } from "ai";
import { google } from "@ai-sdk/google";
import { z } from "zod";
import { NextResponse } from "next/server";

import { buildSystemPrompt, searchKnowledgeBase, getVideoTranscript, webSearch, getTopicInfo } from "@/lib/ai";

const MAX_MESSAGES = 50;
const MODEL = process.env.GEMINI_MODEL || "gemini-2.5-flash";

export async function POST(req: Request) {
  let raw: Record<string, unknown>;
  try {
    raw = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const messages = raw.messages as Array<{ role: string; parts?: unknown[]; content?: string; id?: string }> | undefined;
  const topicId = typeof raw.topicId === "string" ? raw.topicId : undefined;

  if (!Array.isArray(messages) || messages.length === 0 || messages.length > MAX_MESSAGES) {
    return NextResponse.json({ error: "Invalid messages" }, { status: 400 });
  }

  try {
    let topicName = "未选择主题";
    let videoCount = 0;
    let transcribedCount = 0;

    if (topicId) {
      const topic = await getTopicInfo(topicId) as {
        name: string;
        videoCount: number;
        transcribedCount: number;
      } | null;
      if (topic) {
        topicName = topic.name;
        videoCount = topic.videoCount;
        transcribedCount = topic.transcribedCount;
      }
    }

    const modelMessages = await convertToModelMessages(
      messages.map((m) => ({
        role: m.role as "user" | "assistant" | "system",
        parts: m.parts as Array<{ type: string; text?: string;[key: string]: unknown }> ?? [{ type: "text" as const, text: m.content ?? "" }],
      })),
    );

    const result = streamText({
      model: google(MODEL),
      system: buildSystemPrompt(topicName, videoCount, transcribedCount),
      messages: modelMessages,
      maxSteps: 5,
      tools: {
        searchKnowledgeBase: tool({
          description: "在视频转录知识库中搜索相关内容。当用户提出关于知识库主题的问题时使用此工具。",
          parameters: z.object({
            query: z.string().describe("搜索关键词"),
            topicId: z.string().optional().describe("主题ID，限定搜索范围"),
          }),
          execute: async ({ query, topicId: tid }) => {
            const videos = await searchKnowledgeBase(query, tid || topicId);
            return { results: videos, query };
          },
        }),
        getVideoTranscript: tool({
          description: "获取特定视频的完整转录文本。当需要查看某个视频的详细内容时使用。",
          parameters: z.object({
            videoId: z.string().describe("视频ID"),
          }),
          execute: async ({ videoId }) => {
            return getVideoTranscript(videoId);
          },
        }),
        webSearch: tool({
          description: "搜索互联网获取知识库中没有的最新信息。当知识库中找不到答案时使用。",
          parameters: z.object({
            query: z.string().describe("搜索查询"),
          }),
          execute: async ({ query }) => {
            return webSearch(query);
          },
        }),
      },
    });

    return result.toUIMessageStreamResponse();
  } catch (e) {
    console.error("[chat/route] stream error:", e);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}
