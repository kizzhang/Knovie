"use client";

import { Suspense, useRef, useEffect, useCallback, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport } from "ai";
import type { UIMessage } from "ai";
import {
  Loader2,
  Search,
  FileText,
  Globe,
  Bot,
  User,
  Plus,
  Mic,
  ArrowUp,
  ExternalLink,
  History,
  X,
  MessageSquare,
  Trash2,
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
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { useTopic } from "@/lib/topic-context";
import { GlassDistortionSVG, LiquidGlassCard } from "@/components/ui/liquid-glass";
import { listConversations, saveConversation, getConversationMessages, deleteConversation, type SavedConversation } from "@/lib/conversations";
import Link from "next/link";

const TOOL_ICONS: Record<string, { icon: typeof Search; label: string }> = {
  searchKnowledgeBase: { icon: Search, label: "搜索知识库" },
  getVideoTranscript: { icon: FileText, label: "读取转录" },
  webSearch: { icon: Globe, label: "搜索互联网" },
};

const SUGGESTION_PILLS = [
  { icon: Search, label: "知识库里有哪些视频？" },
  { icon: FileText, label: "帮我总结主要观点" },
  { icon: Globe, label: "关键概念是什么？" },
  { icon: User, label: "哪些创作者最好？" },
];

function getTextContent(msg: UIMessage): string {
  return msg.parts
    .filter((p): p is { type: "text"; text: string } => p.type === "text")
    .map((p) => p.text)
    .join("");
}

type ToolPart = {
  type: string;
  toolName: string;
  toolCallId: string;
  state: string;
  input?: unknown;
  output?: unknown;
};

function getToolParts(msg: UIMessage): ToolPart[] {
  return msg.parts.filter(
    (p): p is ToolPart =>
      typeof (p as ToolPart).toolName === "string"
  );
}

export default function ChatPage() {
  return (
    <Suspense>
      <ChatContent />
    </Suspense>
  );
}

function getRelativeTime(isoStr: string): string {
  const diff = Date.now() - new Date(isoStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "刚刚";
  if (mins < 60) return `${mins}分钟前`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}小时前`;
  const days = Math.floor(hrs / 24);
  if (days < 30) return `${days}天前`;
  return `${Math.floor(days / 30)}月前`;
}

function ChatContent() {
  const chatSearchParams = useSearchParams();
  const { selectedTopic, topics, selectTopic } = useTopic();
  const scrollRef = useRef<HTMLDivElement>(null);
  const isAtBottomRef = useRef(true);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const prefillApplied = useRef(false);
  const selectedTopicRef = useRef(selectedTopic);
  selectedTopicRef.current = selectedTopic;

  const [input, setInput] = useState("");
  const [chatId, setChatId] = useState(() => crypto.randomUUID().slice(0, 16));
  const [conversations, setConversations] = useState<SavedConversation[]>([]);
  const [showHistory, setShowHistory] = useState(false);

  const {
    messages,
    setMessages,
    sendMessage,
    status,
    error,
  } = useChat({
    id: chatId,
    transport: new DefaultChatTransport({
      api: "/api/chat",
      body: () => ({ topicId: selectedTopicRef.current?.id }),
    }),
    onError: (err: Error) => toast.error("发送失败: " + err.message),
  });

  const isLoading = status === "submitted" || status === "streaming";

  const scrollToBottom = useCallback(() => {
    const el = scrollRef.current?.querySelector(
      "[data-radix-scroll-area-viewport]"
    ) as HTMLDivElement | null;
    if (el && isAtBottomRef.current) {
      el.scrollTop = el.scrollHeight;
    }
  }, []);

  useEffect(() => {
    const el = scrollRef.current?.querySelector(
      "[data-radix-scroll-area-viewport]"
    ) as HTMLDivElement | null;
    if (!el) return;
    const onScroll = () => {
      isAtBottomRef.current =
        el.scrollHeight - el.scrollTop - el.clientHeight < 60;
    };
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => el.removeEventListener("scroll", onScroll);
  }, []);

  useEffect(() => {
    scrollToBottom();
  }, [messages, scrollToBottom]);

  useEffect(() => {
    if (prefillApplied.current) return;
    const q = chatSearchParams.get("q");
    if (q) {
      setInput(q);
      prefillApplied.current = true;
      setTimeout(() => textareaRef.current?.focus(), 100);
    }
  }, [chatSearchParams]);

  useEffect(() => {
    setConversations(listConversations());
  }, []);

  useEffect(() => {
    if (messages.length > 0 && selectedTopic) {
      const plain = messages.map((m) => ({
        role: m.role,
        content: getTextContent(m),
        id: m.id,
      }));
      saveConversation(chatId, selectedTopic.id, selectedTopic.name, plain);
      setConversations(listConversations());
    }
  }, [messages, chatId, selectedTopic]);

  const startNewChat = () => {
    setChatId(crypto.randomUUID().slice(0, 16));
    setMessages([]);
    setInput("");
    setShowHistory(false);
    prefillApplied.current = false;
  };

  const loadChat = (convo: SavedConversation) => {
    const msgs = getConversationMessages(convo.id);
    setChatId(convo.id);
    setMessages(msgs as Parameters<typeof setMessages>[0]);
    setShowHistory(false);
    const t = topics.find((t) => t.id === convo.topicId);
    if (t) selectTopic(t);
  };

  const removeChat = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    deleteConversation(id);
    setConversations(listConversations());
    if (id === chatId) startNewChat();
  };

  const handleSend = async () => {
    if (!input.trim() || isLoading || !selectedTopic) return;
    const text = input.trim();
    setInput("");
    if (textareaRef.current) {
      textareaRef.current.style.height = "24px";
    }
    await sendMessage({ text });
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const hasMessages = messages.length > 0;
  const canSend = !!selectedTopic && input.trim() && !isLoading;

  const resolveVideoUrl = (href: string) => {
    const match = href.match(/^video:\/\/(bilibili|youtube)\/([^?]+)(?:\?t=(\d+))?$/);
    if (!match) return null;
    const [, platform, videoId, t] = match;
    if (platform === "bilibili") {
      return `https://www.bilibili.com/video/${videoId}${t ? `?t=${t}` : ""}`;
    }
    return `https://www.youtube.com/watch?v=${videoId}${t ? `&t=${t}` : ""}`;
  };

  const markdownComponents = {
    a: ({ href, children, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement> & { children?: React.ReactNode }) => {
      if (href?.startsWith("video://")) {
        const realUrl = resolveVideoUrl(href);
        if (realUrl) {
          return (
            <a
              href={realUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-0.5 rounded bg-primary/8 border border-primary/15 px-1.5 py-0.5 text-[11px] font-medium text-primary no-underline hover:bg-primary/15 transition-colors mx-0.5"
              {...props}
            >
              <ExternalLink className="size-2.5 shrink-0" strokeWidth={2} />
              {children}
            </a>
          );
        }
      }
      return (
        <a href={href} target="_blank" rel="noopener noreferrer" className="text-primary underline underline-offset-2" {...props}>
          {children}
        </a>
      );
    },
  };

  const topicPill = (
    <div className="flex items-center gap-2 mb-2">
      {selectedTopic ? (
        <div className="relative group">
          <button className="flex items-center gap-1.5 rounded-full bg-primary/8 border border-primary/15 px-3 py-1 text-[12px] font-medium text-primary transition-colors hover:bg-primary/12">
            <span className="size-1.5 rounded-full bg-primary" />
            {selectedTopic.name}
            <svg className="size-3 opacity-50" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="6 9 12 15 18 9"/></svg>
          </button>
          <div className="absolute top-full left-0 mt-1 z-50 hidden group-hover:block min-w-[160px] rounded-lg border border-black/[.08] bg-white shadow-lg py-1">
            {topics.map((t) => (
              <button
                key={t.id}
                onClick={() => selectTopic(t)}
                className={`w-full text-left px-3 py-1.5 text-[12px] transition-colors hover:bg-black/[.04] ${
                  t.id === selectedTopic.id ? "font-medium text-primary" : "text-foreground/80"
                }`}
              >
                {t.name}
                <span className="text-[10px] text-[#aaa] ml-1.5">({t.videoCount})</span>
              </button>
            ))}
          </div>
        </div>
      ) : (
        <div className="flex items-center gap-2">
          <span className="text-[12px] text-destructive/80">请先选择主题</span>
          {topics.length > 0 ? (
            <div className="flex gap-1">
              {topics.slice(0, 3).map((t) => (
                <button
                  key={t.id}
                  onClick={() => selectTopic(t)}
                  className="rounded-full border border-black/[.08] bg-white/60 px-2.5 py-0.5 text-[11px] text-foreground/70 transition-colors hover:bg-black/[.04]"
                >
                  {t.name}
                </button>
              ))}
            </div>
          ) : (
            <Link href="/collect" className="text-[12px] text-primary hover:underline underline-offset-2">
              去创建主题
            </Link>
          )}
        </div>
      )}
    </div>
  );

  const promptBox = (
    <form onSubmit={(e) => { e.preventDefault(); handleSend(); }} className="w-full">
      {topicPill}
      <LiquidGlassCard className="px-[18px] pt-[14px] pb-[10px]">
        <textarea
          ref={textareaRef}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder={
            selectedTopic
              ? `关于「${selectedTopic.name}」提问...`
              : "选择主题后即可提问"
          }
          disabled={isLoading || !selectedTopic}
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
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => toast.info("附件功能开发中")}
              aria-label="添加附件"
              className="flex size-8 items-center justify-center rounded-full border border-black/[.10] text-[#999] transition-colors hover:bg-black/[.03] hover:text-[#666]"
            >
              <Plus className="size-4" strokeWidth={1.5} />
            </button>
          </div>
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => toast.info("语音输入功能开发中")}
              aria-label="语音输入"
              className="flex size-8 items-center justify-center rounded-full text-[#999] transition-colors hover:bg-black/[.04] hover:text-[#555]"
            >
              <Mic className="size-4" strokeWidth={1.5} />
            </button>
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
        </div>
      </LiquidGlassCard>
    </form>
  );

  const chatHeader = (
    <div className="flex items-center justify-between px-4 py-2 border-b border-black/[.04]">
      <div className="flex items-center gap-1.5">
        {hasMessages && (
          <button
            onClick={startNewChat}
            className="flex items-center gap-1 rounded-lg border border-black/10 bg-white/60 px-2.5 py-1 text-[12px] font-[450] text-foreground/70 transition-colors hover:bg-white/80"
          >
            <Plus className="size-3" strokeWidth={1.5} />
            新对话
          </button>
        )}
      </div>
      <Sheet open={showHistory} onOpenChange={setShowHistory}>
        <SheetTrigger asChild>
          <button
            className={`flex items-center gap-1 rounded-lg px-2.5 py-1 text-[12px] font-[450] transition-colors ${
              showHistory ? "bg-primary/10 text-primary" : "text-[#999] hover:text-foreground hover:bg-black/[.04]"
            }`}
          >
            <History className="size-3" strokeWidth={1.5} />
            历史 ({conversations.length})
          </button>
        </SheetTrigger>
        <SheetContent side="right" className="w-80 p-0 flex flex-col">
          <SheetHeader className="px-4 pt-4 pb-3 border-b border-black/[.06]">
            <div className="flex items-center justify-between">
              <SheetTitle className="text-[14px] font-medium">对话历史</SheetTitle>
              <button
                onClick={() => { startNewChat(); setShowHistory(false); }}
                className="flex items-center gap-1 rounded-lg border border-black/10 bg-white/60 px-2 py-1 text-[11px] font-[450] text-foreground/70 hover:bg-white/80 transition-colors"
              >
                <Plus className="size-3" strokeWidth={1.5} />
                新对话
              </button>
            </div>
          </SheetHeader>
          <ScrollArea className="flex-1">
            {conversations.length === 0 ? (
              <p className="p-6 text-[12px] text-[#aaa] text-center">暂无历史对话</p>
            ) : (
              <div className="py-1">
                {conversations.map((c) => (
                  <div
                    key={c.id}
                    onClick={() => loadChat(c)}
                    className={`group flex items-start gap-2.5 px-4 py-2.5 cursor-pointer transition-colors hover:bg-black/[.03] ${
                      c.id === chatId ? "bg-primary/5" : ""
                    }`}
                  >
                    <MessageSquare className="size-3.5 shrink-0 text-[#bbb] mt-0.5" strokeWidth={1.5} />
                    <div className="flex-1 min-w-0">
                      <p className="text-[12px] text-foreground truncate leading-tight">{c.title}</p>
                      <p className="text-[10px] text-[#aaa] mt-0.5">
                        {c.topicName} · {c.messageCount} 条 · {getRelativeTime(c.updatedAt)}
                      </p>
                    </div>
                    <button
                      onClick={(e) => removeChat(c.id, e)}
                      className="opacity-0 group-hover:opacity-100 p-1 rounded hover:bg-destructive/10 transition-opacity"
                    >
                      <Trash2 className="size-3 text-destructive/60" strokeWidth={1.5} />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </ScrollArea>
        </SheetContent>
      </Sheet>
    </div>
  );

  if (!hasMessages) {
    return (
      <div className="flex h-full flex-col items-center justify-center px-6 relative">
        <GlassDistortionSVG />
        <div className="absolute top-0 left-0 right-0 z-10">
          {chatHeader}
        </div>
        <div
          className="text-foreground mb-10 select-none"
          style={{ fontSize: "48px", fontWeight: 380, letterSpacing: "-1.5px" }}
        >
          知频
        </div>

        <div className="w-full max-w-[620px]">
          {promptBox}

          {selectedTopic && (
            <div className="flex flex-wrap justify-center gap-2 mt-4">
              {SUGGESTION_PILLS.map((pill) => (
                <LiquidGlassCard
                  key={pill.label}
                  className="rounded-full px-3.5 py-[7px] cursor-pointer"
                >
                  <button
                    onClick={() => {
                      setInput(pill.label);
                      textareaRef.current?.focus();
                    }}
                    className="flex items-center gap-[5px] text-[13px] font-[430] text-[#555]"
                  >
                    <pill.icon className="size-3.5 opacity-50" strokeWidth={1.5} />
                    {pill.label}
                  </button>
                </LiquidGlassCard>
              ))}
            </div>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      <GlassDistortionSVG />
      {chatHeader}
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
                    const toolInfo = TOOL_ICONS[part.toolName];
                    const Icon = toolInfo?.icon || Search;
                    const label = toolInfo?.label || part.toolName;
                    const isDone = part.state === "output-available";
                    const result = isDone ? part.output : null;

                    const summary = (() => {
                      if (!result) return null;
                      if (part.toolName === "searchKnowledgeBase") {
                        const r = result as Record<string, unknown>;
                        const videos = r?.results || r?.videos || result;
                        if (Array.isArray(videos)) return `检索到 ${videos.length} 个相关视频`;
                        return "已完成检索";
                      }
                      if (part.toolName === "getVideoTranscript") {
                        const r = result as Record<string, unknown>;
                        const segs = r?.segments;
                        if (Array.isArray(segs)) return `读取了 ${segs.length} 段转录内容`;
                        return "已读取转录";
                      }
                      if (part.toolName === "webSearch") {
                        const r = result as Record<string, unknown>;
                        const items = r?.results || r?.organic;
                        if (Array.isArray(items)) return `找到 ${items.length} 条搜索结果`;
                        return "已完成搜索";
                      }
                      return "已完成";
                    })();

                    const readableItems = (() => {
                      if (!result) return null;
                      if (part.toolName === "searchKnowledgeBase") {
                        const r = result as Record<string, unknown>;
                        const videos = r?.results || (Array.isArray(result) ? result : null);
                        if (!Array.isArray(videos)) return null;
                        return videos.slice(0, 5).map((v: Record<string, unknown>, j: number) => (
                          <div key={j} className="text-[11px] text-[#666] py-0.5">
                            · {String(v.title || "未知视频")} <span className="text-[#aaa]">— {String(v.creatorName || "")}</span>
                          </div>
                        ));
                      }
                      if (part.toolName === "webSearch") {
                        const r = result as Record<string, unknown>;
                        const items = r?.results || r?.organic;
                        if (!Array.isArray(items)) return null;
                        return items.slice(0, 3).map((r: Record<string, unknown>, j: number) => (
                          <div key={j} className="text-[11px] text-[#666] py-0.5 truncate">
                            · {String(r.title || r.link || "")}
                          </div>
                        ));
                      }
                      return null;
                    })();

                    return (
                      <Collapsible key={i}>
                        <CollapsibleTrigger asChild>
                          <button className="flex items-center gap-1.5 text-[11px] text-[#999] hover:text-foreground transition-colors py-1">
                            {isDone ? (
                              <Icon className="size-3" strokeWidth={1.5} />
                            ) : (
                              <Loader2 className="size-3 animate-spin" />
                            )}
                            <span>
                              {isDone
                                ? (summary || `已${label}`)
                                : `正在${label}...`}
                            </span>
                            {isDone && (
                              <span className="rounded bg-black/[.04] px-1 py-0.5 text-[10px] text-[#aaa]">
                                展开
                              </span>
                            )}
                          </button>
                        </CollapsibleTrigger>
                        {isDone && (
                          <CollapsibleContent>
                            <div className="mt-1 rounded-lg bg-[#f5f5f2] p-3 space-y-1">
                              {readableItems && (
                                <div className="pb-1.5 border-b border-black/[.06]">
                                  {readableItems}
                                </div>
                              )}
                              <Collapsible>
                                <CollapsibleTrigger asChild>
                                  <button className="text-[10px] text-[#aaa] hover:text-[#666] transition-colors pt-1">
                                    开发者视图
                                  </button>
                                </CollapsibleTrigger>
                                <CollapsibleContent>
                                  <pre className="mt-1 max-h-36 overflow-auto text-[10px] text-[#777] leading-relaxed">
                                    {JSON.stringify(result, null, 2)}
                                  </pre>
                                </CollapsibleContent>
                              </Collapsible>
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
                          <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents}>
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

          {isLoading && messages[messages.length - 1]?.role === "user" && (
            <div className="flex gap-3">
              <div className="flex size-7 shrink-0 items-center justify-center rounded-full bg-primary/10 mt-1">
                <Bot className="size-3.5 text-primary" strokeWidth={1.5} />
              </div>
              <LiquidGlassCard className="px-4 py-3">
                <Loader2 className="size-4 animate-spin text-[#bbb]" />
              </LiquidGlassCard>
            </div>
          )}

          {error && (
            <div className="text-center text-[12px] text-destructive py-2">
              出错了: {error.message}
            </div>
          )}
        </div>
      </ScrollArea>

      <div className="px-4 py-3 bg-background">
        <div className="max-w-3xl mx-auto">{promptBox}</div>
      </div>
    </div>
  );
}
