import { streamText, tool, convertToModelMessages, stepCountIs } from "ai";
import { google } from "@ai-sdk/google";
import type { GoogleGenerativeAIProviderOptions } from "@ai-sdk/google";
import { z } from "zod";
import { NextResponse } from "next/server";

import {
  getTopicInfo,
  getTopicKnowledge,
  shouldDumpKnowledge,
  buildDumpSystemPrompt,
  buildSearchSystemPrompt,
  searchTranscripts,
  getVideoTranscript,
  webSearch,
} from "@/lib/ai";

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

    let systemPrompt: string;
    let isDumpMode = false;

    if (topicId) {
      const knowledge = await getTopicKnowledge(topicId);
      if (knowledge && shouldDumpKnowledge(knowledge.totalChars)) {
        isDumpMode = true;
        systemPrompt = buildDumpSystemPrompt(topicName, knowledge.knowledge);
        console.log(`[chat] dump mode: topic="${topicName}" videos=${knowledge.videoCount} chars=${knowledge.totalChars}`);
      } else {
        systemPrompt = buildSearchSystemPrompt(topicName, videoCount, transcribedCount);
        console.log(`[chat] search mode: topic="${topicName}" chars=${knowledge?.totalChars ?? "?"}`);
      }
    } else {
      systemPrompt = buildSearchSystemPrompt(topicName, videoCount, transcribedCount);
    }

    const modelMessages = await convertToModelMessages(
      messages.map((m) => ({
        role: m.role as "user" | "assistant" | "system",
        parts: m.parts as Array<{ type: string; text?: string;[key: string]: unknown }> ?? [{ type: "text" as const, text: m.content ?? "" }],
      })),
    );

    const tools: Record<string, ReturnType<typeof tool>> = {
      searchTranscripts: tool({
        description: "在视频转录知识库中搜索匹配的文字片段。返回包含匹配内容、视频标题、创作者和平台信息的结果列表。",
        parameters: z.object({
          query: z.string().describe("搜索关键词"),
        }),
        execute: async ({ query }) => {
          const results = await searchTranscripts(query, topicId);
          return { results, query };
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
    };

    if (!isDumpMode) {
      tools.getVideoTranscript = tool({
        description: "获取特定视频的完整转录文本。当需要查看某个视频的详细内容时使用。",
        parameters: z.object({
          videoId: z.string().describe("视频ID"),
        }),
        execute: async ({ videoId }) => {
          return getVideoTranscript(videoId);
        },
      });
    }

    const result = streamText({
      model: google(MODEL),
      system: systemPrompt,
      messages: modelMessages,
      stopWhen: stepCountIs(isDumpMode ? 5 : 7),
      tools,
      providerOptions: {
        google: {
          thinkingConfig: {
            thinkingBudget: 1024,
          },
        } satisfies GoogleGenerativeAIProviderOptions,
      },
    });

    return result.toUIMessageStreamResponse({
      onError(error) {
        console.error("[chat/route] stream error:", error);
        if (error instanceof Error) return error.message;
        return String(error);
      },
    });
  } catch (e) {
    console.error("[chat/route] top-level error:", e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Internal server error" },
      { status: 500 },
    );
  }
}
