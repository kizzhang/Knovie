"use client";

import { Suspense, useRef, useEffect, useCallback, useState } from "react";
import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport } from "ai";
import type { UIMessage } from "ai";
import {
  Loader2,
  Search,
  Youtube,
  Globe,
  Bot,
  User,
  Plus,
  ArrowUp,
  ExternalLink,
  Sparkles,
  Play,
  Eye,
  Clock,
  Video,
} from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { toast } from "sonner";

import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { GlassDistortionSVG, LiquidGlassCard } from "@/components/ui/liquid-glass";

export default function AgentPage() {
  return (
    <Suspense>
      <AgentContent />
    </Suspense>
  );
}

const TOOL_ICONS: Record<string, { icon: typeof Search; label: string }> = {
  searchYouTube: { icon: Youtube, label: "搜索 YouTube" },
  analyzeVideo: { icon: Video, label: "分析视频" },
  webSearch: { icon: Globe, label: "搜索互联网" },
};

const SUGGESTION_PILLS = [
  { icon: Search, label: "量化交易最新动态" },
  { icon: Youtube, label: "3Blue1Brown 数学可视化" },
  { icon: Sparkles, label: "AI Agent 开发教程" },
  { icon: Globe, label: "2025 年最值得看的科技频道" },
];

function formatDuration(seconds: number): string {
  if (!seconds) return "";
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  return `${m}:${String(s).padStart(2, "0")}`;
}

function formatViewCount(count: number | null): string {
  if (!count) return "";
  if (count >= 1_000_000) return `${(count / 1_000_000).toFixed(1)}M`;
  if (count >= 1_000) return `${(count / 1_000).toFixed(1)}K`;
  return String(count);
}

function getTextContent(msg: UIMessage): string {
  return msg.parts
    .filter((p): p is { type: "text"; text: string } => p.type === "text")
    .map((p) => p.text)
    .join("");
}

type ToolPart = {
  type: string;
  toolName?: string;
  toolCallId: string;
  state: string;
  input?: Record<string, unknown>;
  output?: unknown;
  errorText?: string;
};

function extractToolName(part: ToolPart): string | null {
  if (part.toolName) return part.toolName;
  const t = part.type;
  if (t.startsWith("tool-")) {
    return t.slice(5);
  }
  return null;
}

function getToolParts(msg: UIMessage): (ToolPart & { resolvedName: string })[] {
  return msg.parts
    .filter((p): p is ToolPart => {
      const tp = p as ToolPart;
      return typeof tp.toolCallId === "string" && (
        typeof tp.toolName === "string" ||
        (typeof tp.type === "string" && tp.type.startsWith("tool-"))
      );
    })
    .map((p) => ({ ...p, resolvedName: extractToolName(p) || p.type }));
}

interface VideoResult {
  id: string;
  title: string;
  channel: string;
  thumbnail: string;
  duration: number;
  viewCount: number | null;
  uploadDate: string | null;
  url: string;
}

function VideoCard({ video }: { video: VideoResult }) {
  return (
    <a
      href={video.url}
      target="_blank"
      rel="noopener noreferrer"
      className="group flex gap-3 rounded-lg border border-black/[.06] bg-white/60 p-2.5 transition-colors hover:bg-white/90 hover:border-black/[.10]"
    >
      <div className="relative w-[140px] h-[79px] shrink-0 rounded-md overflow-hidden bg-black/5">
        {video.thumbnail ? (
          <img
            src={video.thumbnail}
            alt=""
            className="w-full h-full object-cover"
            loading="lazy"
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center">
            <Play className="size-6 text-[#ccc]" />
          </div>
        )}
        {video.duration > 0 && (
          <span className="absolute bottom-1 right-1 bg-black/75 text-white text-[10px] font-medium px-1 py-0.5 rounded">
            {formatDuration(video.duration)}
          </span>
        )}
      </div>
      <div className="flex-1 min-w-0 py-0.5">
        <p className="text-[12px] font-medium text-foreground leading-snug line-clamp-2 group-hover:text-primary transition-colors">
          {video.title}
        </p>
        <p className="text-[11px] text-[#999] mt-1 truncate">{video.channel}</p>
        <div className="flex items-center gap-2 mt-1 text-[10px] text-[#bbb]">
          {video.viewCount ? (
            <span className="flex items-center gap-0.5">
              <Eye className="size-2.5" /> {formatViewCount(video.viewCount)}
            </span>
          ) : null}
          {video.uploadDate ? (
            <span className="flex items-center gap-0.5">
              <Clock className="size-2.5" /> {video.uploadDate.replace(/(\d{4})(\d{2})(\d{2})/, "$1-$2-$3")}
            </span>
          ) : null}
        </div>
      </div>
    </a>
  );
}

function SearchResults({ results }: { results: VideoResult[] }) {
  if (!results.length) return null;
  return (
    <div className="grid gap-2 mt-2">
      {results.map((v) => (
        <VideoCard key={v.id} video={v} />
      ))}
    </div>
  );
}

function AgentContent() {
  const scrollRef = useRef<HTMLDivElement>(null);
  const isAtBottomRef = useRef(true);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const [input, setInput] = useState("");

  const {
    messages,
    setMessages,
    sendMessage,
    status,
    error,
  } = useChat({
    id: "agent",
    transport: new DefaultChatTransport({ api: "/api/agent" }),
    onError: (err: Error) => toast.error("发送失败: " + err.message),
  });

  const isLoading = status === "submitted" || status === "streaming";
  const hasMessages = messages.length > 0;
  const canSend = !!input.trim() && !isLoading;

  const scrollToBottom = useCallback(() => {
    const el = scrollRef.current?.querySelector(
      "[data-radix-scroll-area-viewport]",
    ) as HTMLDivElement | null;
    if (el && isAtBottomRef.current) {
      el.scrollTop = el.scrollHeight;
    }
  }, []);

  useEffect(() => {
    const el = scrollRef.current?.querySelector(
      "[data-radix-scroll-area-viewport]",
    ) as HTMLDivElement | null;
    if (!el) return;
    const onScroll = () => {
      isAtBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 60;
    };
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => el.removeEventListener("scroll", onScroll);
  }, []);

  useEffect(() => {
    scrollToBottom();
  }, [messages, scrollToBottom]);

  const handleSend = async () => {
    if (!canSend) return;
    const text = input.trim();
    setInput("");
    if (textareaRef.current) textareaRef.current.style.height = "24px";
    await sendMessage({ text });
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const startNewChat = () => {
    setMessages([]);
    setInput("");
  };

  const markdownComponents = {
    a: ({
      href,
      children,
      ...props
    }: React.AnchorHTMLAttributes<HTMLAnchorElement> & {
      children?: React.ReactNode;
    }) => {
      const isYouTube =
        href?.includes("youtube.com") || href?.includes("youtu.be");
      return (
        <a
          href={href}
          target="_blank"
          rel="noopener noreferrer"
          className={
            isYouTube
              ? "inline-flex items-center gap-0.5 rounded bg-red-500/8 border border-red-500/15 px-1.5 py-0.5 text-[11px] font-medium text-red-600 no-underline hover:bg-red-500/15 transition-colors mx-0.5"
              : "text-primary underline underline-offset-2"
          }
          {...props}
        >
          {isYouTube && <ExternalLink className="size-2.5 shrink-0" strokeWidth={2} />}
          {children}
        </a>
      );
    },
  };

  const promptBox = (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        handleSend();
      }}
      className="w-full"
    >
      <LiquidGlassCard className="px-[18px] pt-[14px] pb-[10px]">
        <textarea
          ref={textareaRef}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder="输入话题、频道名或 YouTube URL..."
          disabled={isLoading}
          rows={1}
          aria-label="输入消息"
          className="w-full resize-none border-none outline-none bg-transparent text-[15px] font-[420] text-foreground placeholder:text-[#bbb] leading-relaxed pb-2.5 disabled:opacity-50"
          style={{ fontFamily: "inherit", minHeight: "24px", maxHeight: "120px" }}
          onInput={(e) => {
            const t = e.currentTarget;
            t.style.height = "24px";
            t.style.height = Math.min(t.scrollHeight, 120) + "px";
          }}
        />
        <div className="flex items-center justify-between pt-1">
          <div className="flex items-center gap-1.5 text-[11px] text-[#bbb]">
            <Sparkles className="size-3" strokeWidth={1.5} />
            <span>Gemini 驱动</span>
          </div>
          <button
            type="submit"
            disabled={!canSend}
            className="flex size-8 items-center justify-center rounded-full bg-foreground text-white transition-opacity hover:opacity-80 disabled:bg-black/[.07] disabled:text-[#ccc]"
          >
            {isLoading ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <ArrowUp className="size-4" strokeWidth={2} />
            )}
          </button>
        </div>
      </LiquidGlassCard>
    </form>
  );

  const renderToolResult = (part: ToolPart & { resolvedName: string }) => {
    const isDone = part.state === "output-available";
    const result = isDone ? part.output : null;
    const name = part.resolvedName;

    if (name === "searchYouTube" && isDone && result) {
      const r = result as { results?: VideoResult[]; query?: string };
      const videos = r.results || [];
      return (
        <div>
          <p className="text-[11px] text-[#999] mb-1.5">
            搜索到 {videos.length} 个视频
          </p>
          <SearchResults results={videos} />
        </div>
      );
    }

    if (name === "analyzeVideo" && isDone && result) {
      const r = result as { method?: string };
      return (
        <p className="text-[11px] text-[#999]">
          分析完成（{r.method === "subtitle" ? "字幕分析" : "视频直传"}）
        </p>
      );
    }

    if (name === "webSearch" && isDone && result) {
      const items = Array.isArray(result) ? result : [];
      return (
        <p className="text-[11px] text-[#999]">
          找到 {items.length} 条搜索结果
        </p>
      );
    }

    return null;
  };

  if (!hasMessages) {
    return (
      <div className="flex h-full flex-col items-center justify-center px-6 relative">
        <GlassDistortionSVG />
        {/* Header */}
        <div className="absolute top-0 left-0 right-0 z-10">
          <div className="flex items-center justify-between px-4 py-2 border-b border-black/[.04]" />
        </div>

        <div className="flex flex-col items-center mb-10 select-none">
          <div className="flex items-center gap-2 mb-2">
            <Sparkles className="size-8 text-primary" strokeWidth={1.5} />
            <span
              className="text-foreground"
              style={{ fontSize: "36px", fontWeight: 380, letterSpacing: "-1px" }}
            >
              AI 探索
            </span>
          </div>
          <p className="text-[13px] text-[#999] font-[420]">
            搜索、发现和深度分析 YouTube 视频
          </p>
        </div>

        <div className="w-full max-w-[620px]">
          {promptBox}

          <div className="flex flex-wrap justify-center gap-2 mt-4">
            {SUGGESTION_PILLS.map((pill) => (
              <LiquidGlassCard
                key={pill.label}
                className="rounded-full px-3.5 py-[7px] cursor-pointer"
              >
                <button
                  onClick={() => setInput(pill.label)}
                  className="flex items-center gap-[5px] text-[13px] font-[430] text-[#555]"
                >
                  <pill.icon className="size-3.5 opacity-50" strokeWidth={1.5} />
                  {pill.label}
                </button>
              </LiquidGlassCard>
            ))}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      <GlassDistortionSVG />

      {/* Header */}
      <div className="flex items-center justify-between px-4 py-2 border-b border-black/[.04]">
        <div className="flex items-center gap-2">
          <Sparkles className="size-4 text-primary" strokeWidth={1.5} />
          <span className="text-[13px] font-medium text-foreground/80">AI 探索</span>
        </div>
        <button
          onClick={startNewChat}
          className="flex items-center gap-1 rounded-lg border border-black/10 bg-white/60 px-2.5 py-1 text-[12px] font-[450] text-foreground/70 transition-colors hover:bg-white/80"
        >
          <Plus className="size-3" strokeWidth={1.5} />
          新对话
        </button>
      </div>

      {/* Messages */}
      <ScrollArea className="flex-1" ref={scrollRef}>
        <div className="max-w-3xl mx-auto px-4 py-6 space-y-5">
          {messages.map((msg) => {
            const textContent = getTextContent(msg);
            const toolParts = getToolParts(msg);

            return (
              <div
                key={msg.id}
                className={`flex gap-3 ${msg.role === "user" ? "justify-end" : ""}`}
              >
                {msg.role === "assistant" && (
                  <div className="flex size-7 shrink-0 items-center justify-center rounded-full bg-primary/10 mt-1">
                    <Bot className="size-3.5 text-primary" strokeWidth={1.5} />
                  </div>
                )}

                <div
                  className={`max-w-[85%] space-y-2 ${msg.role === "user" ? "order-first" : ""}`}
                >
                  {toolParts.map((part, i) => {
                    const toolInfo = TOOL_ICONS[part.resolvedName];
                    const Icon = toolInfo?.icon || Search;
                    const label = toolInfo?.label || part.resolvedName;
                    const isDone = part.state === "output-available";
                    const isError = part.state === "output-error";
                    const isInputStreaming = part.state === "input-streaming";
                    const isInputReady = part.state === "input-available";
                    const isExecuting = isInputReady;
                    const isFinished = isDone || isError;
                    const isWaiting = isInputStreaming || isExecuting;

                    const inputSummary = part.input
                      ? part.resolvedName === "searchYouTube"
                        ? `"${(part.input as Record<string, unknown>).query ?? ""}"`
                        : part.resolvedName === "analyzeVideo"
                          ? (part.input as Record<string, unknown>).video_url as string ?? ""
                          : part.resolvedName === "webSearch"
                            ? `"${(part.input as Record<string, unknown>).query ?? ""}"`
                            : ""
                      : "";

                    return (
                      <Collapsible key={part.toolCallId || i} defaultOpen={part.resolvedName === "searchYouTube" && isDone}>
                        <CollapsibleTrigger asChild>
                          <button className={`flex items-center gap-1.5 text-[11px] transition-colors py-1 ${isError ? "text-destructive/70 hover:text-destructive" : "text-[#999] hover:text-foreground"}`}>
                            {isFinished ? (
                              <Icon className="size-3" strokeWidth={1.5} />
                            ) : (
                              <Loader2 className="size-3 animate-spin" />
                            )}
                            <span>
                              {isError
                                ? `${label}失败`
                                : isDone
                                  ? `已${label}`
                                  : isInputStreaming
                                    ? `准备${label}...`
                                    : `正在${label}...`}
                            </span>
                            {inputSummary && isWaiting && (
                              <span className="text-[10px] text-[#bbb] truncate max-w-[200px]">{inputSummary}</span>
                            )}
                            {isFinished && (
                              <span className="rounded bg-black/[.04] px-1 py-0.5 text-[10px] text-[#aaa]">
                                {part.resolvedName === "searchYouTube" && isDone ? "收起" : "展开"}
                              </span>
                            )}
                          </button>
                        </CollapsibleTrigger>
                        {isFinished && (
                          <CollapsibleContent>
                            <div className={`mt-1 rounded-lg p-3 ${isError ? "bg-destructive/5 border border-destructive/10" : "bg-[#f5f5f2]"}`}>
                              {isError ? (
                                <p className="text-[11px] text-destructive/70">
                                  {part.errorText || "工具执行出错，AI 将尝试其他方式回答"}
                                </p>
                              ) : (
                                renderToolResult(part)
                              )}
                            </div>
                          </CollapsibleContent>
                        )}
                      </Collapsible>
                    );
                  })}

                  {msg.role === "user" ? (
                    <div className="rounded-2xl bg-foreground text-white px-4 py-2.5">
                      <p className="text-[13px] whitespace-pre-wrap leading-relaxed">
                        {textContent}
                      </p>
                    </div>
                  ) : (
                    textContent && (
                      <LiquidGlassCard className="px-4 py-3">
                        <div className="prose prose-sm max-w-none text-[13px] leading-relaxed">
                          <ReactMarkdown
                            remarkPlugins={[remarkGfm]}
                            components={markdownComponents}
                          >
                            {textContent}
                          </ReactMarkdown>
                        </div>
                      </LiquidGlassCard>
                    )
                  )}
                </div>

                {msg.role === "user" && (
                  <div className="flex size-7 shrink-0 items-center justify-center rounded-full bg-[#f3f3f0] mt-1">
                    <User className="size-3.5 text-[#888]" strokeWidth={1.5} />
                  </div>
                )}
              </div>
            );
          })}

          {isLoading && (() => {
            const lastMsg = messages[messages.length - 1];
            const hasAssistantContent = lastMsg?.role === "assistant" && (
              getTextContent(lastMsg) || getToolParts(lastMsg).length > 0
            );
            return !hasAssistantContent;
          })() && (
            <div className="flex gap-3">
              <div className="flex size-7 shrink-0 items-center justify-center rounded-full bg-primary/10 mt-1">
                <Bot className="size-3.5 text-primary" strokeWidth={1.5} />
              </div>
              <LiquidGlassCard className="px-4 py-3">
                <div className="flex items-center gap-2">
                  <Loader2 className="size-4 animate-spin text-[#bbb]" />
                  <span className="text-[12px] text-[#999]">思考中...</span>
                </div>
              </LiquidGlassCard>
            </div>
          )}

          {error && (
            <div className="mx-auto max-w-md rounded-lg border border-destructive/20 bg-destructive/5 p-3 text-center">
              <p className="text-[12px] font-medium text-destructive mb-1">出错了</p>
              <p className="text-[11px] text-destructive/70">{error.message}</p>
            </div>
          )}
        </div>
      </ScrollArea>

      {/* Input */}
      <div className="px-4 py-3 bg-background">
        <div className="max-w-3xl mx-auto">{promptBox}</div>
      </div>
    </div>
  );
}
