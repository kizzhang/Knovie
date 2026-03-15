import { streamText, tool, convertToModelMessages, stepCountIs } from "ai";
import { google } from "@ai-sdk/google";
import type { GoogleGenerativeAIProviderOptions } from "@ai-sdk/google";
import { z } from "zod";
import { NextResponse } from "next/server";
import { fetchBackend } from "@/lib/backend";

const MODEL = process.env.GEMINI_MODEL || "gemini-2.5-flash";
const MAX_MESSAGES = 40;

const SYSTEM_PROMPT = `You are "知频探索" (Video Explorer), a professional YouTube video research assistant.

## Core Rules
- You MUST use tools to get information. NEVER fabricate video titles, URLs, or content.
- You are a proactive research assistant. Understand user intent flexibly and take action.
- When users ask for "research", "deep dive", "find lots of videos", or "调研", you MUST call searchYouTube multiple times with different keywords to cover the topic broadly. A single search is NOT sufficient for research tasks — you must make at least 3 searches with varied keywords before synthesizing.

## Tools
1. **searchYouTube** — Search YouTube videos. Call multiple times with varied keywords to widen coverage. Each call can return up to 20 results.
2. **analyzeVideo** — Deep-analyze a single video's full content (subtitles + visual). Takes 10-60s per video. Can be called consecutively for multiple videos.
3. **webSearch** — Search the web for supplementary info (Reddit threads, blog posts, GitHub repos, etc).

## Operating Modes

### Quick Search (simple query, single topic)
→ Call searchYouTube once, present results, recommend top 2-3.

### Deep Research (user says "research", "调研", "find lots of", "deep dive", "大量")
→ Call searchYouTube 3-5 times with different keyword angles. Example for "vibe coding":
  - Core topic: "vibe coding"
  - Tutorials: "vibe coding tutorial 2025"
  - Real projects: "vibe coding SaaS production app"
  - Key creators: "vibe coding cursor lovable bolt"
  - Reviews/critique: "vibe coding review pros cons"
→ Merge all results, deduplicate by video ID, categorize by theme.
→ Produce a structured research report with categories, recommendations, and key findings.
→ Optionally call webSearch for Reddit/community perspectives.

### Video Analysis (user provides URL or references a video)
→ Call analyzeVideo with the URL. Deliver a structured analysis report.
→ When user asks to analyze multiple videos, call analyzeVideo for each sequentially.

### Context References
→ "the 2nd one", "第2个", "the one with most views" → You MUST look through the conversation history, find the referenced video's full YouTube URL from previous searchYouTube results, then call analyzeVideo with that exact URL. Never call analyzeVideo without a valid URL.

## Response Format
- Default language: Chinese (中文), unless user writes in English.
- Search results: Include full YouTube links as [Title](https://www.youtube.com/watch?v=ID)
- Analysis reports: Structured with key takeaways, timestamps, conclusions.
- Research reports: Categorized by theme, with video + channel + view count + recommendation reason.
- Timestamp links: [MM:SS](https://www.youtube.com/watch?v=ID&t=SECONDs)

## Important
- ALL video links must come from tool results. Never invent URLs.
- Use the "description" field from search results to judge relevance before recommending.
- If a tool returns an error, explain the reason and suggest alternatives.`;

export async function POST(req: Request) {
  let raw: Record<string, unknown>;
  try {
    raw = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const messages = raw.messages as Array<{
    role: string;
    parts?: unknown[];
    content?: string;
    id?: string;
  }> | undefined;

  if (!Array.isArray(messages) || messages.length === 0 || messages.length > MAX_MESSAGES) {
    return NextResponse.json({ error: "Invalid messages" }, { status: 400 });
  }

  try {
    const modelMessages = await convertToModelMessages(
      messages.map((m) => ({
        role: m.role as "user" | "assistant" | "system",
        parts: (m.parts as Array<{ type: string; text?: string; [key: string]: unknown }>) ??
          [{ type: "text" as const, text: m.content ?? "" }],
      })),
    );

    const tools = {
      searchYouTube: tool({
        description:
          "Search YouTube videos by topic, channel name, or keywords. Can be called multiple times with different queries to broaden coverage. Returns title, channel, duration, view count, and description snippet for each video. For research tasks, use max_results=15-20.",
        parameters: z.object({
          query: z.string().describe("Search keywords — topic, channel name, or specific content"),
          max_results: z.number().optional().default(10).describe("Number of results to return, 1-30. Use 15-20 for research tasks."),
        }),
        execute: async ({ query, max_results }) => {
          const data = await fetchBackend<{
            results: Array<{
              id: string;
              title: string;
              channel: string;
              channelId: string;
              thumbnail: string;
              duration: number;
              viewCount: number | null;
              uploadDate: string | null;
              description: string;
              url: string;
            }>;
            query: string;
          }>("/api/agent/search-youtube", {
            method: "POST",
            body: JSON.stringify({ query, max_results }),
          });
          return data;
        },
      }),

      analyzeVideo: tool({
        description:
          "Deep-analyze a single YouTube video's full content using subtitles or direct video understanding. You MUST provide the full YouTube URL (e.g. https://www.youtube.com/watch?v=XXXXX). If the user says 'the first one' or 'that video', extract the URL from previous search results in the conversation before calling this tool. Can be called consecutively for multiple videos.",
        parameters: z.object({
          video_url: z.string().describe("Full YouTube video URL, e.g. https://www.youtube.com/watch?v=dQw4w9WgXcQ"),
          question: z.string().optional().default("").describe("Optional specific question about the video"),
        }),
        execute: async (args) => {
          const videoUrl = args.video_url || (args as Record<string, unknown>).url as string || (args as Record<string, unknown>).video_url as string || "";
          if (!videoUrl || (!videoUrl.includes("youtube.com/watch") && !videoUrl.includes("youtu.be/"))) {
            return { error: true, message: `Invalid or missing YouTube URL: "${videoUrl}". Please provide a full YouTube URL like https://www.youtube.com/watch?v=XXXXX` };
          }
          const question = args.question || "";
          const data = await fetchBackend<{
            videoId: string;
            analysis: string;
            method: string;
            url: string;
          }>("/api/agent/analyze-video", {
            method: "POST",
            body: JSON.stringify({ video_url: videoUrl, question }),
          });
          return data;
        },
      }),

      webSearch: tool({
        description: "Search the internet for supplementary information. Use for Reddit discussions, blog posts, GitHub projects, and other non-YouTube sources.",
        parameters: z.object({
          query: z.string().describe("Search query"),
        }),
        execute: async ({ query }) => {
          const serperKey = process.env.SERPER_API_KEY;
          if (!serperKey) {
            return [{ title: "Web search unavailable", snippet: "No API key", url: "" }];
          }
          const res = await fetch("https://google.serper.dev/search", {
            method: "POST",
            headers: { "X-API-KEY": serperKey, "Content-Type": "application/json" },
            body: JSON.stringify({ q: query, gl: "cn", hl: "zh-cn", num: 5 }),
          });
          const data = await res.json();
          return (data.organic || []).map(
            (r: { title: string; snippet: string; link: string }) => ({
              title: r.title,
              snippet: r.snippet,
              url: r.link,
            }),
          );
        },
      }),
    };

    const result = streamText({
      model: google(MODEL),
      system: SYSTEM_PROMPT,
      messages: modelMessages,
      stopWhen: stepCountIs(15),
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
        console.error("[agent/route] stream error:", error);
        if (error instanceof Error) return error.message;
        return String(error);
      },
    });
  } catch (e) {
    console.error("[agent/route] top-level error:", e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Internal server error" },
      { status: 500 },
    );
  }
}
