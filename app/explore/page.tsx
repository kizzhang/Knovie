"use client";

import { Suspense, useEffect, useState, useCallback } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import Link from "next/link";
import {
  Search,
  Video as VideoIcon,
  ExternalLink,
  Clock,
  Eye,
  ThumbsUp,
  Download,
  ChevronLeft,
  ChevronRight,
  Copy,
  Check,
  MessageSquare,
  Users,
  Mic,
  Loader2,
  Link2,
  X,
} from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { useTopic } from "@/lib/topic-context";
import { GlassDistortionSVG, LiquidGlassCard } from "@/components/ui/liquid-glass";
import { ProxiedImage } from "@/components/ui/proxied-image";
import type { Video, TranscriptSegment } from "@/lib/types";

export default function ExplorePage() {
  return (
    <Suspense>
      <ExploreContent />
    </Suspense>
  );
}

function ExploreContent() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const { selectedTopic, topics, selectTopic } = useTopic();

  const [videos, setVideos] = useState<Video[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [platformFilter, setPlatformFilter] = useState<string>("all");
  const [transcriptFilter, setTranscriptFilter] = useState<string>("all");
  const [loading, setLoading] = useState(true);

  const [selectedVideo, setSelectedVideo] = useState<Video | null>(null);
  const [transcript, setTranscript] = useState<{
    segments: TranscriptSegment[];
    fullText: string;
  } | null>(null);
  const [transcriptLoading, setTranscriptLoading] = useState(false);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [transcriptSearch, setTranscriptSearch] = useState("");
  const [copiedIdx, setCopiedIdx] = useState<number | null>(null);
  const [activeTab, setActiveTab] = useState<"videos" | "creators">("videos");
  const [creators, setCreators] = useState<{
    id: string; name: string; platform: string; platformUid: string;
    avatarUrl?: string; videoCount: number; transcribedCount: number; totalViews: number;
  }[]>([]);
  const [creatorsLoading, setCreatorsLoading] = useState(false);
  const [transcribing, setTranscribing] = useState(false);
  const [transcribeMsg, setTranscribeMsg] = useState("");
  const [creatorSearch, setCreatorSearch] = useState("");
  const [urlSearch, setUrlSearch] = useState("");
  const [urlSearching, setUrlSearching] = useState(false);
  const [creatorIdFilter, setCreatorIdFilter] = useState<string | null>(null);
  const [creatorNameFilter, setCreatorNameFilter] = useState<string | null>(null);
  const [showUrlSearch, setShowUrlSearch] = useState(false);

  useEffect(() => {
    const tid = searchParams.get("topicId");
    if (tid && topics.length > 0) {
      const t = topics.find((t) => t.id === tid);
      if (t) selectTopic(t);
    }
  }, [searchParams, topics, selectTopic]);

  const fetchVideos = useCallback(async () => {
    setLoading(true);
    setFetchError(null);
    try {
      const params = new URLSearchParams({ page: String(page), pageSize: "20" });
      if (selectedTopic) params.set("topicId", selectedTopic.id);
      if (search) params.set("search", search);
      if (platformFilter !== "all") params.set("platform", platformFilter);
      if (transcriptFilter !== "all")
        params.set("hasTranscript", transcriptFilter === "yes" ? "true" : "false");
      if (creatorIdFilter) params.set("creatorId", creatorIdFilter);

      const res = await fetch(`/api/videos?${params}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setVideos(data.videos || []);
      setTotal(data.total || 0);
    } catch (e) {
      setFetchError(e instanceof Error ? e.message : "加载视频失败");
      setVideos([]);
      setTotal(0);
    } finally {
      setLoading(false);
    }
  }, [page, selectedTopic, search, platformFilter, transcriptFilter, creatorIdFilter]);

  useEffect(() => {
    const timer = setTimeout(fetchVideos, 300);
    return () => clearTimeout(timer);
  }, [fetchVideos]);

  const fetchCreators = useCallback(async () => {
    setCreatorsLoading(true);
    try {
      const params = new URLSearchParams();
      if (selectedTopic) params.set("topicId", selectedTopic.id);
      if (creatorSearch.trim()) params.set("search", creatorSearch.trim());
      const res = await fetch(`/api/creators?${params}`);
      if (res.ok) setCreators(await res.json());
    } catch { /* ignore */ }
    finally { setCreatorsLoading(false); }
  }, [selectedTopic, creatorSearch]);

  useEffect(() => {
    if (activeTab === "creators") {
      const timer = setTimeout(fetchCreators, 300);
      return () => clearTimeout(timer);
    }
  }, [activeTab, fetchCreators]);

  const openVideoDetail = async (video: Video) => {
    setSelectedVideo(video);
    setTranscript(null);
    setTranscriptSearch("");
    setCopiedIdx(null);
    if (video.hasTranscript) {
      setTranscriptLoading(true);
      try {
        const res = await fetch(`/api/videos/${video.id}/transcript`);
        if (res.ok) setTranscript(await res.json());
      } catch {
        // ignore
      } finally {
        setTranscriptLoading(false);
      }
    }
  };

  const formatDuration = (s: number) => {
    const hrs = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const sec = s % 60;
    if (hrs > 0) return `${hrs}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
    return `${m}:${String(sec).padStart(2, "0")}`;
  };

  const highlightText = (text: string, query: string) => {
    if (!query) return text;
    const regex = new RegExp(`(${query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")})`, "gi");
    const parts = text.split(regex);
    return parts.map((part, i) =>
      regex.test(part) ? (
        <mark key={i} className="bg-yellow-200/60 rounded-sm px-0.5">{part}</mark>
      ) : (
        part
      )
    );
  };

  const totalPages = Math.ceil(total / 20);

  const buildVideoUrl = (video: Video, seconds?: number) => {
    if (video.platform === "bilibili") {
      const base = `https://www.bilibili.com/video/${video.platformVideoId}`;
      return seconds != null ? `${base}?t=${Math.floor(seconds)}` : base;
    }
    const base = `https://www.youtube.com/watch?v=${video.platformVideoId}`;
    return seconds != null ? `${base}&t=${Math.floor(seconds)}` : base;
  };

  const copyCitation = (video: Video, seg: TranscriptSegment, idx: number) => {
    const ts = formatDuration(Math.floor(seg.start));
    const text = `${video.title} - ${ts} - ${seg.text}`;
    navigator.clipboard.writeText(text).then(() => {
      setCopiedIdx(idx);
      toast.success("已复制引用");
      setTimeout(() => setCopiedIdx(null), 1500);
    });
  };

  const filteredSegments = transcript?.segments.filter((seg) =>
    transcriptSearch ? seg.text.toLowerCase().includes(transcriptSearch.toLowerCase()) : true
  );

  const askAI = (question: string) => {
    setSelectedVideo(null);
    const params = new URLSearchParams({ q: question });
    router.push(`/chat?${params}`);
  };

  const startTranscribe = async () => {
    if (!selectedTopic || transcribing) return;
    try {
      setTranscribing(true);
      const res = await fetch("/api/transcribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ topicId: selectedTopic.id }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || data.detail || "转录启动失败");
      toast.success("转录任务已启动");

      const poll = setInterval(async () => {
        try {
          const sr = await fetch(`/api/collect/${data.taskId}/status`);
          const task = await sr.json();
          if (task.message) setTranscribeMsg(task.message);
          if (task.status === "done" || task.status === "failed") {
            clearInterval(poll);
            setTranscribing(false);
            setTranscribeMsg("");
            if (task.status === "done") {
              toast.success("转录完成");
              fetchVideos();
            } else {
              toast.error(`转录失败: ${task.errorMsg || "未知错误"}`);
            }
          }
        } catch { /* ignore */ }
      }, 3000);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "转录启动失败");
      setTranscribing(false);
    }
  };

  const searchByUrl = async () => {
    if (!urlSearch.trim()) return;
    setUrlSearching(true);
    setFetchError(null);
    try {
      const params = new URLSearchParams({ url: urlSearch.trim(), pageSize: "20" });
      if (selectedTopic) params.set("topicId", selectedTopic.id);
      const res = await fetch(`/api/videos?${params}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      if (data.error) {
        toast.error(data.error);
      } else if (data.total === 0) {
        toast.info("未找到匹配的视频");
      } else {
        setVideos(data.videos || []);
        setTotal(data.total || 0);
        setSearch("");
        setPage(1);
        toast.success(`找到 ${data.total} 个匹配视频`);
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "搜索失败");
    } finally {
      setUrlSearching(false);
    }
  };

  return (
    <div className="p-6 space-y-4 max-w-7xl">
      <GlassDistortionSVG />
      {/* Tabs */}
      <div className="flex gap-1 border-b border-black/[.06] mb-1">
        {([["videos", "视频", VideoIcon], ["creators", "创作者", Users]] as const).map(([key, label, TabIcon]) => (
          <button
            key={key}
            onClick={() => setActiveTab(key as "videos" | "creators")}
            className={cn(
              "flex items-center gap-1.5 px-3 py-2 text-[13px] font-[450] border-b-2 transition-colors -mb-px",
              activeTab === key
                ? "border-primary text-primary"
                : "border-transparent text-[#999] hover:text-foreground"
            )}
          >
            <TabIcon className="size-3.5" strokeWidth={1.5} />
            {label}
          </button>
        ))}
      </div>

      {activeTab === "videos" && <>
      {/* Filters - Row 1 */}
      <div className="flex flex-wrap gap-3 items-center">
        <div className="flex-1 min-w-[200px] max-w-md relative group">
          <Search
            className={cn(
              "absolute left-3 top-1/2 -translate-y-1/2 size-[14px]",
              transcriptFilter === "no" ? "text-[#ccc]" : "text-[#aaa]"
            )}
            strokeWidth={1.5}
          />
          <Input
            placeholder={transcriptFilter === "no" ? "未转录视频暂不支持内容搜索" : "搜索转录内容..."}
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(1);
            }}
            disabled={transcriptFilter === "no"}
            className={cn(
              "h-8 pl-8 rounded-lg border-black/10 bg-white/40 backdrop-blur-sm text-[13px] placeholder:text-[#bbb]",
              transcriptFilter === "no" && "opacity-50 cursor-not-allowed"
            )}
          />
        </div>
        <button
          onClick={() => setShowUrlSearch(!showUrlSearch)}
          className={cn(
            "flex items-center gap-1 h-8 px-2.5 rounded-lg border text-[12px] font-[450] transition-colors",
            showUrlSearch
              ? "border-primary/30 bg-primary/5 text-primary"
              : "border-black/10 bg-white/40 backdrop-blur-sm text-[#999] hover:text-foreground"
          )}
          title="按链接查找视频"
        >
          <Link2 className="size-3.5" strokeWidth={1.5} />
        </button>
        <Select
          value={platformFilter}
          onValueChange={(v) => {
            setPlatformFilter(v);
            setPage(1);
          }}
        >
          <SelectTrigger className="w-28 h-8 rounded-lg border-black/10 bg-white/40 backdrop-blur-sm text-[12px] font-[450]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">全部平台</SelectItem>
            <SelectItem value="bilibili">B站</SelectItem>
            <SelectItem value="youtube">YouTube</SelectItem>
          </SelectContent>
        </Select>
        <Select
          value={transcriptFilter}
          onValueChange={(v) => {
            setTranscriptFilter(v);
            if (v === "no") setSearch("");
            setPage(1);
          }}
        >
          <SelectTrigger className="w-28 h-8 rounded-lg border-black/10 bg-white/40 backdrop-blur-sm text-[12px] font-[450]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">全部状态</SelectItem>
            <SelectItem value="yes">已转录</SelectItem>
            <SelectItem value="no">未转录</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* URL search - collapsible row */}
      {showUrlSearch && (
        <div className="flex items-center gap-2">
          <div className="relative flex-1 max-w-md">
            <Link2 className="absolute left-3 top-1/2 -translate-y-1/2 size-[14px] text-[#aaa]" strokeWidth={1.5} />
            <Input
              placeholder="粘贴视频链接查找..."
              value={urlSearch}
              onChange={(e) => setUrlSearch(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && searchByUrl()}
              className="h-8 pl-8 pr-8 rounded-lg border-black/10 bg-white/40 backdrop-blur-sm text-[13px] placeholder:text-[#bbb]"
            />
            {urlSearch && (
              <button
                onClick={() => { setUrlSearch(""); fetchVideos(); }}
                className="absolute right-2 top-1/2 -translate-y-1/2 p-0.5 rounded hover:bg-black/5"
              >
                <X className="size-3 text-[#bbb]" strokeWidth={1.5} />
              </button>
            )}
          </div>
          <button
            onClick={searchByUrl}
            disabled={urlSearching || !urlSearch.trim()}
            className="shrink-0 h-8 px-3 rounded-lg bg-primary text-white text-[12px] font-medium hover:opacity-90 transition-opacity disabled:opacity-50"
          >
            {urlSearching ? "查找中..." : "查找"}
          </button>
        </div>
      )}

      {creatorNameFilter && (
        <div className="flex items-center gap-2 text-[12px]">
          <span className="text-[#999]">筛选创作者：</span>
          <span className="inline-flex items-center gap-1 rounded-full bg-primary/10 text-primary px-2.5 py-0.5 text-[11px] font-medium">
            {creatorNameFilter}
            <button
              onClick={() => {
                setCreatorIdFilter(null);
                setCreatorNameFilter(null);
                setPage(1);
              }}
              className="ml-0.5 rounded-full hover:bg-primary/20 p-0.5"
            >
              <X className="size-2.5" strokeWidth={2} />
            </button>
          </span>
        </div>
      )}

      {/* Transcribe banner */}
      {selectedTopic && selectedTopic.videoCount > 0 && selectedTopic.transcribedCount < selectedTopic.videoCount && (
        <div className="flex items-center gap-3 rounded-lg border border-amber-200/60 bg-amber-50/40 px-3.5 py-2">
          <div className="flex-1 min-w-0 text-[12px] text-amber-800/80">
            {transcribing && transcribeMsg ? (
              <span className="truncate block">{transcribeMsg}</span>
            ) : (
              <><span className="font-medium">{selectedTopic.videoCount - selectedTopic.transcribedCount} 个视频</span>未转录，转录后可搜索内容和 AI 问答</>
            )}
          </div>
          <button
            onClick={startTranscribe}
            disabled={transcribing}
            className="flex items-center gap-1 shrink-0 rounded-md bg-amber-600 text-white px-2.5 py-1 text-[11px] font-medium hover:bg-amber-700 transition-colors disabled:opacity-50"
          >
            {transcribing ? (
              <><Loader2 className="size-3 animate-spin" />转录中...</>
            ) : (
              <><Mic className="size-3" strokeWidth={1.5} />继续转录</>
            )}
          </button>
        </div>
      )}

      <div className="text-[12px] text-[#999]">共 {total} 个视频</div>

      {fetchError && (
        <div className="rounded-lg border border-destructive/30 bg-destructive/5 px-4 py-3 text-[13px] text-destructive flex items-center gap-2">
          加载失败：{fetchError}
          <button
            onClick={fetchVideos}
            className="ml-1 underline underline-offset-2 hover:no-underline"
          >
            重试
          </button>
        </div>
      )}

      {/* Video Grid */}
      {loading ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {[...Array(8)].map((_, i) => (
            <LiquidGlassCard key={i} className="overflow-hidden">
              <Skeleton className="aspect-video w-full" />
              <div className="p-3 space-y-2">
                <Skeleton className="h-3.5 w-3/4" />
                <Skeleton className="h-3 w-1/2" />
              </div>
            </LiquidGlassCard>
          ))}
        </div>
      ) : videos.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 text-center">
          <VideoIcon
            className="size-10 text-[#ccc] mb-3"
            strokeWidth={1.5}
          />
          <h3
            className="text-foreground"
            style={{ fontSize: "18px", fontWeight: 500, letterSpacing: "-0.4px", lineHeight: "28px" }}
          >
            没有找到视频
          </h3>
          <p className="mt-1" style={{ fontSize: "14px", letterSpacing: "-0.4px", lineHeight: "20px", color: "oklch(0.2642 0.013 93.9 / 0.65)" }}>
            {search ? "尝试其他搜索关键词" : "去采集一些视频吧"}
          </p>
          {!search && (
            <Link href="/collect" className="mt-4">
              <Button
                className="rounded-lg"
                style={{ fontSize: "14px", fontWeight: 500, letterSpacing: "-0.4px", lineHeight: "28px" }}
              >
                <Download className="size-4" strokeWidth={1.5} />
                去采集
              </Button>
            </Link>
          )}
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {videos.map((v) => (
            <LiquidGlassCard
              key={v.id}
              className="group cursor-pointer overflow-hidden"
            >
            <div onClick={() => openVideoDetail(v)}>
              {v.thumbnailUrl ? (
                <div className="relative aspect-video bg-[#f3f3f0]">
                  <ProxiedImage
                    src={v.thumbnailUrl}
                    alt={v.title}
                    className="w-full h-full object-cover"
                    fallbackClassName="w-full h-full bg-[#f3f3f0] flex items-center justify-center"
                  />
                  <div className="absolute bottom-1.5 right-1.5 bg-black/70 text-white text-[10px] px-1.5 py-0.5 rounded">
                    {formatDuration(v.duration)}
                  </div>
                  <div className="absolute top-1.5 right-1.5">
                    <span
                      className={`inline-block rounded px-1.5 py-0.5 text-[10px] font-medium ${
                        v.hasTranscript
                          ? "bg-positive/90 text-white"
                          : "bg-black/40 text-white/80"
                      }`}
                    >
                      {v.hasTranscript ? "已转录" : "未转录"}
                    </span>
                  </div>
                </div>
              ) : (
                <div className="aspect-video bg-[#f3f3f0] flex items-center justify-center">
                  <VideoIcon className="size-6 text-[#ccc]" strokeWidth={1.5} />
                </div>
              )}
              <div className="p-3 space-y-1.5">
                <h3 className="text-[13px] font-medium leading-snug line-clamp-2 text-foreground">
                  {v.title}
                </h3>
                <div className="flex items-center justify-between text-[11px] text-[#999]">
                  <span className="truncate">{v.creatorName}</span>
                  <span className="shrink-0 rounded border border-black/[.08] px-1 py-0.5 text-[10px] text-[#aaa]">
                    {v.platform === "bilibili" ? "B站" : "YT"}
                  </span>
                </div>
                <div className="flex gap-3 text-[11px] text-[#aaa]">
                  {v.viewCount != null && (
                    <span className="flex items-center gap-0.5">
                      <Eye className="size-3" strokeWidth={1.5} />
                      {v.viewCount >= 10000
                        ? `${(v.viewCount / 10000).toFixed(1)}万`
                        : v.viewCount.toLocaleString()}
                    </span>
                  )}
                  {v.likeCount != null && v.likeCount > 0 && (
                    <span className="flex items-center gap-0.5">
                      <ThumbsUp className="size-3" strokeWidth={1.5} />
                      {v.likeCount}
                    </span>
                  )}
                </div>
              </div>
            </div>
            </LiquidGlassCard>
          ))}
        </div>
      )}

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex justify-center items-center gap-2 pt-4">
          <button
            disabled={page <= 1}
            onClick={() => setPage(page - 1)}
            className="flex items-center gap-1 rounded-lg border border-black/10 bg-white/40 backdrop-blur-sm px-3 py-1.5 transition-colors hover:bg-white/60 disabled:opacity-40 disabled:cursor-not-allowed"
            style={{ fontSize: "14px", fontWeight: 500, letterSpacing: "-0.4px", lineHeight: "28px", color: "oklch(0.2642 0.013 93.9)" }}
          >
            <ChevronLeft className="size-3" strokeWidth={1.5} />
            上一页
          </button>
          <span className="text-[12px] px-3" style={{ color: "oklch(0.2642 0.013 93.9 / 0.65)" }}>
            {page} / {totalPages}
          </span>
          <button
            disabled={page >= totalPages}
            onClick={() => setPage(page + 1)}
            className="flex items-center gap-1 rounded-lg border border-black/10 bg-white/40 backdrop-blur-sm px-3 py-1.5 transition-colors hover:bg-white/60 disabled:opacity-40 disabled:cursor-not-allowed"
            style={{ fontSize: "14px", fontWeight: 500, letterSpacing: "-0.4px", lineHeight: "28px", color: "oklch(0.2642 0.013 93.9)" }}
          >
            下一页
            <ChevronRight className="size-3" strokeWidth={1.5} />
          </button>
        </div>
      )}

      </>}

      {/* Creators Tab */}
      {activeTab === "creators" && (
        <>
          <div className="flex items-center gap-3">
            <div className="relative flex-1 max-w-sm">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-[14px] text-[#aaa]" strokeWidth={1.5} />
              <Input
                placeholder="搜索创作者名称..."
                value={creatorSearch}
                onChange={(e) => setCreatorSearch(e.target.value)}
                className="h-8 pl-8 rounded-lg border-black/10 bg-white/40 backdrop-blur-sm text-[13px] placeholder:text-[#bbb]"
              />
            </div>
            <span className="text-[12px] text-[#999]">共 {creators.length} 位创作者</span>
          </div>
          {creatorsLoading ? (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {[...Array(6)].map((_, i) => (
              <LiquidGlassCard key={i} className="p-4">
                <div className="flex items-center gap-3">
                  <Skeleton className="size-10 rounded-full" />
                  <div className="space-y-1.5 flex-1">
                    <Skeleton className="h-3.5 w-2/3" />
                    <Skeleton className="h-3 w-1/2" />
                  </div>
                </div>
              </LiquidGlassCard>
            ))}
          </div>
        ) : creators.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 text-center">
            <Users className="size-10 text-[#ccc] mb-3" strokeWidth={1.5} />
            <h3
              className="text-foreground"
              style={{ fontSize: "18px", fontWeight: 500, letterSpacing: "-0.4px", lineHeight: "28px" }}
            >
              暂无创作者
            </h3>
            <p className="mt-1 text-[14px] text-[#999]">采集视频后，创作者信息会自动出现</p>
          </div>
        ) : (
          <>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {creators.map((c) => (
                <LiquidGlassCard key={c.id} className="p-4">
                  <div className="flex items-center gap-3">
                    {c.avatarUrl ? (
                      <ProxiedImage src={c.avatarUrl} alt={c.name} className="size-10 rounded-full object-cover bg-[#f3f3f0]" fallbackClassName="size-10 rounded-full bg-primary/10 flex items-center justify-center text-primary text-[14px] font-medium" />
                    ) : (
                      <div className="size-10 rounded-full bg-primary/10 flex items-center justify-center text-primary text-[14px] font-medium">
                        {c.name.charAt(0)}
                      </div>
                    )}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5">
                        <span className="text-[14px] font-medium text-foreground truncate">{c.name}</span>
                        <span className="shrink-0 rounded border border-black/[.08] px-1 py-0.5 text-[10px] text-[#aaa]">
                          {c.platform === "bilibili" ? "B站" : "YT"}
                        </span>
                      </div>
                      <div className="flex gap-3 mt-0.5 text-[11px] text-[#aaa]">
                        <span>{c.videoCount} 个视频</span>
                        <span>{c.transcribedCount} 已转录</span>
                        {c.totalViews > 0 && (
                          <span className="flex items-center gap-0.5">
                            <Eye className="size-2.5" strokeWidth={1.5} />
                            {c.totalViews >= 10000
                              ? `${(c.totalViews / 10000).toFixed(1)}万`
                              : c.totalViews.toLocaleString()}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                  <button
                    onClick={() => {
                      setCreatorIdFilter(c.id);
                      setCreatorNameFilter(c.name);
                      setActiveTab("videos");
                      setSearch("");
                      setPlatformFilter("all");
                      setTranscriptFilter("all");
                      setPage(1);
                    }}
                    className="mt-2.5 w-full rounded-md border border-black/[.08] bg-white/40 py-1.5 text-[12px] text-foreground/70 hover:bg-white/70 transition-colors"
                  >
                    查看该创作者视频
                  </button>
                </LiquidGlassCard>
              ))}
            </div>
          </>
        )}
        </>
      )}

      {/* Video Detail Dialog */}
      <Dialog
        open={!!selectedVideo}
        onOpenChange={(open) => !open && setSelectedVideo(null)}
      >
        <DialogContent className="max-w-3xl max-h-[85vh] overflow-hidden flex flex-col rounded-xl">
          {selectedVideo && (
            <>
              <DialogHeader>
                <DialogTitle className="text-[15px] font-medium leading-snug pr-6 tracking-tight">
                  {selectedVideo.title}
                </DialogTitle>
              </DialogHeader>
              <div className="flex flex-wrap items-center gap-3 text-[12px] text-[#888]">
                <span>{selectedVideo.creatorName}</span>
                <span className="rounded border border-black/[.08] px-1.5 py-0.5 text-[10px] text-[#aaa]">
                  {selectedVideo.platform === "bilibili" ? "B站" : "YouTube"}
                </span>
                <span className="flex items-center gap-1">
                  <Clock className="size-3" strokeWidth={1.5} />
                  {formatDuration(selectedVideo.duration)}
                </span>
                {selectedVideo.viewCount != null && (
                  <span className="flex items-center gap-1">
                    <Eye className="size-3" strokeWidth={1.5} />
                    {selectedVideo.viewCount.toLocaleString()}
                  </span>
                )}
                <a
                  href={
                    selectedVideo.platform === "bilibili"
                      ? `https://www.bilibili.com/video/${selectedVideo.platformVideoId}`
                      : `https://www.youtube.com/watch?v=${selectedVideo.platformVideoId}`
                  }
                  target="_blank"
                  rel="noopener noreferrer"
                  className="ml-auto flex items-center gap-1 text-primary hover:underline underline-offset-2"
                >
                  <ExternalLink className="size-3" strokeWidth={1.5} />
                  原视频
                </a>
              </div>
              {selectedVideo.description && (
                <p className="text-[12px] text-[#999] line-clamp-3 leading-relaxed">
                  {selectedVideo.description}
                </p>
              )}
              {selectedVideo.hasTranscript && (
                <div className="flex flex-wrap gap-1.5">
                  <button
                    onClick={() => askAI(`总结这条视频的主要内容：「${selectedVideo.title}」`)}
                    className="flex items-center gap-1 rounded-lg border border-primary/20 bg-primary/5 px-2.5 py-1 text-[11px] font-medium text-primary transition-colors hover:bg-primary/10"
                  >
                    <MessageSquare className="size-3" strokeWidth={1.5} />
                    问 AI：总结这条视频
                  </button>
                  <button
                    onClick={() => askAI(`分析这条视频的关键观点和论据：「${selectedVideo.title}」`)}
                    className="flex items-center gap-1 rounded-lg border border-primary/20 bg-primary/5 px-2.5 py-1 text-[11px] font-medium text-primary transition-colors hover:bg-primary/10"
                  >
                    <MessageSquare className="size-3" strokeWidth={1.5} />
                    问 AI：提取观点
                  </button>
                </div>
              )}
              <div className="flex-1 min-h-0">
                {transcriptLoading ? (
                  <div className="space-y-2 py-4">
                    {[...Array(5)].map((_, i) => (
                      <Skeleton key={i} className="h-3.5 w-full" />
                    ))}
                  </div>
                ) : transcript ? (
                  <>
                    <div className="flex items-center gap-2 mb-2">
                      <h4 className="text-[12px] font-medium text-foreground shrink-0">
                        转录内容
                      </h4>
                      <div className="relative flex-1 max-w-[240px]">
                        <Search className="absolute left-2 top-1/2 -translate-y-1/2 size-3 text-[#bbb]" strokeWidth={1.5} />
                        <input
                          placeholder="在转录中搜索..."
                          value={transcriptSearch}
                          onChange={(e) => setTranscriptSearch(e.target.value)}
                          className="w-full h-6 pl-6 pr-2 rounded border border-black/10 bg-white/60 text-[11px] placeholder:text-[#ccc] focus:outline-none focus:ring-1 focus:ring-primary/30"
                        />
                      </div>
                      {transcriptSearch && (
                        <span className="text-[10px] text-[#aaa] shrink-0">
                          {filteredSegments?.length || 0} 条匹配
                        </span>
                      )}
                    </div>
                    <ScrollArea className="h-full max-h-[380px]">
                      <div className="space-y-0.5 pr-4">
                        {(filteredSegments || []).map((seg, i) => {
                          const tsText = formatDuration(Math.floor(seg.start));
                          const videoUrl = buildVideoUrl(selectedVideo, seg.start);
                          return (
                            <div key={i} className="group/seg flex gap-2 text-[12px] py-1 rounded hover:bg-black/[.02] transition-colors">
                              <a
                                href={videoUrl}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="text-[11px] text-primary/70 hover:text-primary w-14 shrink-0 pt-0.5 text-right font-mono tabular-nums hover:underline underline-offset-2"
                                title={`在原视频 ${tsText} 处观看`}
                              >
                                {tsText}
                              </a>
                              <span className="text-foreground/85 leading-relaxed flex-1">
                                {transcriptSearch ? (
                                  highlightText(seg.text, transcriptSearch)
                                ) : (
                                  seg.text
                                )}
                              </span>
                              <div className="opacity-0 group-hover/seg:opacity-100 transition-opacity shrink-0 flex items-center gap-0.5">
                                <button
                                  onClick={() => askAI(`解释视频「${selectedVideo.title}」中 ${tsText} 时刻的这段内容：「${seg.text}」`)}
                                  className="p-0.5 rounded hover:bg-black/5"
                                  title="问 AI 解释这段"
                                >
                                  <MessageSquare className="size-3 text-primary/50 hover:text-primary" strokeWidth={1.5} />
                                </button>
                                <button
                                  onClick={() => copyCitation(selectedVideo, seg, i)}
                                  className="p-0.5 rounded hover:bg-black/5"
                                  title="复制引用"
                                >
                                  {copiedIdx === i ? (
                                    <Check className="size-3 text-positive" strokeWidth={1.5} />
                                  ) : (
                                    <Copy className="size-3 text-[#bbb]" strokeWidth={1.5} />
                                  )}
                                </button>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </ScrollArea>
                  </>
                ) : selectedVideo.hasTranscript ? (
                  <p className="text-[12px] text-[#999] py-4">加载转录失败</p>
                ) : (
                  <p className="text-[12px] text-[#999] py-4">
                    该视频暂无转录内容
                  </p>
                )}
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
