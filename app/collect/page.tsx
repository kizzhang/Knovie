"use client";

import { useState, useEffect, useRef, Suspense } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import {
  Download,
  Library,
  MessageSquare,
  Loader2,
  CheckCircle2,
  AlertCircle,
  ChevronDown,
  ChevronUp,
  StopCircle,
  FolderPlus,
  FolderSync,
  Link2,
  Plus,
  Search,
  Video as VideoIcon,
  Users,
  RefreshCw,
  XCircle,
} from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useTopic } from "@/lib/topic-context";
import { GlassDistortionSVG, LiquidGlassCard } from "@/components/ui/liquid-glass";
import type { Platform, Topic } from "@/lib/types";

type CollectMode = "keyword" | "video" | "creator";

interface ConflictTopic {
  id: string;
  name: string;
  videoCount: number;
  transcribedCount: number;
  creatorCount: number;
  status: string;
}

function CollectContent() {
  const { refreshTopics, selectTopic, topics } = useTopic();
  const searchParams = useSearchParams();

  const [mode, setMode] = useState<CollectMode>("keyword");

  // --- Keyword collect state ---
  const [name, setName] = useState("");
  const [platforms, setPlatforms] = useState<Platform[]>(["bilibili"]);
  const [maxCreators, setMaxCreators] = useState(10);
  const [maxVideos, setMaxVideos] = useState(0);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [conflictTopic, setConflictTopic] = useState<ConflictTopic | null>(null);
  const [appendMode, setAppendMode] = useState(false);
  const appendInitialized = useRef(false);

  // --- Import state (shared by video/creator) ---
  const [importUrl, setImportUrl] = useState("");
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState<{
    ok: boolean; title?: string; creator?: string; platform: string; videoCount?: number;
  } | null>(null);
  const [importTopicId, setImportTopicId] = useState<string>("");
  const [importNewTopicName, setImportNewTopicName] = useState("");
  const [importMaxVideos, setImportMaxVideos] = useState(30);

  // --- Task/progress state ---
  const [createdTopic, setCreatedTopic] = useState<{ id: string; name: string } | null>(null);
  const [taskId, setTaskId] = useState<string | null>(null);
  const [taskStatus, setTaskStatus] = useState<string>("");
  const [progress, setProgress] = useState(0);
  const [message, setMessage] = useState("");
  const [collecting, setCollecting] = useState(false);
  const [done, setDone] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const isCancelled = taskStatus === "failed" && message === "已手动取消";

  // --- Init from URL params (append mode) ---
  useEffect(() => {
    if (appendInitialized.current) return;
    const topicId = searchParams.get("topicId");
    const urlMode = searchParams.get("mode");
    if (topicId && urlMode === "append") {
      appendInitialized.current = true;
      fetch(`/api/topics/${topicId}`)
        .then((r) => (r.ok ? r.json() : null))
        .then((topic) => {
          if (topic) {
            setAppendMode(true);
            setCreatedTopic({ id: topic.id, name: topic.name });
            setName(topic.name);
            setImportTopicId(topic.id);
            if (topic.platforms?.length) setPlatforms(topic.platforms);
          }
        })
        .catch(() => {});
    }
  }, [searchParams]);

  // --- Restore active task from localStorage ---
  useEffect(() => {
    try {
      const saved = localStorage.getItem("knovie_active_task");
      if (saved) {
        const { taskId: savedId, topicId, topicName } = JSON.parse(saved);
        if (savedId) {
          setTaskId(savedId);
          setCreatedTopic({ id: topicId, name: topicName });
          setCollecting(true);
          startPolling(savedId);
        }
      }
    } catch { /* ignore */ }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, []);

  const isAppendUI = appendMode && createdTopic;

  // --- Keyword collect logic ---
  const togglePlatform = (p: Platform) => {
    setPlatforms((prev) => prev.includes(p) ? prev.filter((x) => x !== p) : [...prev, p]);
  };

  const startCollectForTopic = async (topicId: string, topicName: string) => {
    setMessage("触发采集...");
    const collectRes = await fetch("/api/collect", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ topicId, platforms }),
    });
    const collectData = await collectRes.json();
    if (!collectRes.ok) throw new Error(collectData.error || "触发采集失败");
    setTaskId(collectData.taskId);
    try {
      localStorage.setItem("knovie_active_task", JSON.stringify({ taskId: collectData.taskId, topicId, topicName }));
    } catch { /* ignore */ }
    startPolling(collectData.taskId);
    await refreshTopics();
  };

  const startCollect = async () => {
    if (appendMode && createdTopic) {
      try {
        setCollecting(true); setDone(false); setProgress(0); setConflictTopic(null);
        await startCollectForTopic(createdTopic.id, createdTopic.name);
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "操作失败");
        setCollecting(false);
      }
      return;
    }
    if (!name.trim()) { toast.error("请输入主题名称"); return; }
    if (platforms.length === 0) { toast.error("至少选择一个平台"); return; }
    try {
      setCollecting(true); setDone(false); setProgress(0); setMessage("创建主题..."); setConflictTopic(null);
      const topicRes = await fetch("/api/topics", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name.trim(), platforms, maxCreators, maxVideosPerCreator: maxVideos }),
      });
      const topicData = await topicRes.json();
      if (topicData.conflict && topicData.existingTopic) {
        setConflictTopic(topicData.existingTopic); setCollecting(false); setMessage(""); return;
      }
      if (!topicRes.ok) throw new Error(topicData.error || "创建主题失败");
      setCreatedTopic({ id: topicData.id, name: topicData.name || name.trim() });
      await startCollectForTopic(topicData.id, topicData.name || name.trim());
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "操作失败");
      setCollecting(false);
    }
  };

  const handleAppendExisting = async () => {
    if (!conflictTopic) return;
    try {
      setCollecting(true); setDone(false); setProgress(0); setConflictTopic(null); setAppendMode(true);
      setCreatedTopic({ id: conflictTopic.id, name: conflictTopic.name });
      await startCollectForTopic(conflictTopic.id, conflictTopic.name);
    } catch (err) { toast.error(err instanceof Error ? err.message : "操作失败"); setCollecting(false); }
  };

  const handleForceCreate = async () => {
    if (!name.trim() || platforms.length === 0) return;
    try {
      setCollecting(true); setDone(false); setProgress(0); setConflictTopic(null); setMessage("创建主题...");
      const topicRes = await fetch("/api/topics?force=true", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name.trim(), platforms, maxCreators, maxVideosPerCreator: maxVideos }),
      });
      const topicData = await topicRes.json();
      if (!topicRes.ok) throw new Error(topicData.error || "创建主题失败");
      setCreatedTopic({ id: topicData.id, name: topicData.name || name.trim() });
      await startCollectForTopic(topicData.id, topicData.name || name.trim());
    } catch (err) { toast.error(err instanceof Error ? err.message : "操作失败"); setCollecting(false); }
  };

  // --- Import logic ---
  const resolveImportTopicId = async (): Promise<string | null> => {
    if (createdTopic) return createdTopic.id;
    if (importTopicId === "__new__") {
      if (!importNewTopicName.trim()) { toast.error("请输入新主题名称"); return null; }
      try {
        const res = await fetch("/api/topics", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name: importNewTopicName.trim(), platforms: ["bilibili", "youtube"] }),
        });
        const data = await res.json();
        if (data.conflict && data.existingTopic) {
          setImportTopicId(data.existingTopic.id);
          toast.info(`已有同名主题「${data.existingTopic.name}」，已自动选择`);
          return data.existingTopic.id;
        }
        if (!res.ok) throw new Error(data.detail || data.error || "创建主题失败");
        await refreshTopics();
        setImportTopicId(data.id);
        setImportNewTopicName("");
        return data.id;
      } catch (err) { toast.error(err instanceof Error ? err.message : "创建主题失败"); return null; }
    }
    if (importTopicId) return importTopicId;
    toast.error("请先选择一个目标主题");
    return null;
  };

  const handleImportVideo = async () => {
    if (!importUrl.trim()) return;
    setImporting(true); setImportResult(null);
    try {
      const topicId = await resolveImportTopicId();
      if (!topicId) { setImporting(false); return; }
      const res = await fetch("/api/import-video", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ topicId, url: importUrl.trim() }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.detail || data.error || data.message || "导入失败");
      setImportResult(data); setImportUrl("");
      toast.success(`成功导入：${data.title}`);
      await refreshTopics();
    } catch (err) { toast.error(err instanceof Error ? err.message : "导入失败"); }
    finally { setImporting(false); }
  };

  const handleImportCreator = async () => {
    if (!importUrl.trim()) return;
    setImporting(true); setImportResult(null);
    try {
      const topicId = await resolveImportTopicId();
      if (!topicId) { setImporting(false); return; }
      const res = await fetch("/api/import-creator", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ topicId, url: importUrl.trim(), maxVideos: importMaxVideos }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.detail || data.error || data.message || "导入失败");
      setImportResult(data); setImportUrl("");
      toast.success(`成功导入 ${data.creator} 的 ${data.videoCount} 个视频`);
      await refreshTopics();
    } catch (err) { toast.error(err instanceof Error ? err.message : "导入失败"); }
    finally { setImporting(false); }
  };

  // --- Polling / cancel ---
  const startPolling = (tid: string) => {
    if (pollRef.current) clearInterval(pollRef.current);
    pollRef.current = setInterval(async () => {
      try {
        const res = await fetch(`/api/collect/${tid}/status`);
        const task = await res.json();
        setTaskStatus(task.status);
        setProgress(Math.round((task.progress || 0) * 100));
        setMessage(task.message || "");
        if (task.status === "done" || task.status === "failed") {
          if (pollRef.current) clearInterval(pollRef.current);
          setCollecting(false); setDone(true);
          try { localStorage.removeItem("knovie_active_task"); } catch { /* ignore */ }
          await refreshTopics();
          if (task.status === "done") toast.success("采集和转录完成！");
          else toast.error(`采集失败: ${task.errorMsg || "未知错误"}`);
        }
      } catch { /* ignore */ }
    }, 2000);
  };

  const cancelTask = async () => {
    if (!taskId) return;
    try {
      const res = await fetch(`/api/collect/${taskId}/cancel`, { method: "POST" });
      if (res.ok) {
        if (pollRef.current) clearInterval(pollRef.current);
        setCollecting(false); setDone(true); setTaskStatus("failed"); setMessage("已手动取消");
        try { localStorage.removeItem("knovie_active_task"); } catch { /* ignore */ }
        toast.info("任务已取消");
      }
    } catch { toast.error("取消失败"); }
  };

  const resetAll = () => {
    setDone(false); setTaskStatus(""); setProgress(0); setMessage("");
    setCollecting(false); setTaskId(null);
  };

  // --- Tab config ---
  const TABS: { key: CollectMode; label: string; icon: typeof Search }[] = [
    { key: "keyword", label: "关键词采集", icon: Search },
    { key: "video", label: "导入视频", icon: VideoIcon },
    { key: "creator", label: "导入创作者", icon: Users },
  ];

  // --- Topic selector for import tabs ---
  const renderTopicSelector = () => {
    if (createdTopic) {
      return (
        <div className="mb-3 flex items-center gap-1.5 text-[12px] text-[#999]">
          <span>导入到：</span>
          <span className="font-medium text-foreground">{createdTopic.name}</span>
        </div>
      );
    }
    return (
      <div className="mb-3">
        <label className="text-[12px] text-[#999] mb-1 block">导入到主题</label>
        <Select value={importTopicId} onValueChange={(v) => { setImportTopicId(v); setImportNewTopicName(""); }}>
          <SelectTrigger className="w-full h-8 rounded-lg border-black/10 bg-white/60 backdrop-blur-sm text-[13px] font-[450]">
            <SelectValue placeholder="选择目标主题..." />
          </SelectTrigger>
          <SelectContent>
            {topics.map((t) => (
              <SelectItem key={t.id} value={t.id}>
                {t.name} ({t.videoCount ?? 0})
              </SelectItem>
            ))}
            <SelectItem value="__new__">
              <span className="flex items-center gap-1 text-primary">
                <Plus className="size-3" strokeWidth={2} />
                创建新主题
              </span>
            </SelectItem>
          </SelectContent>
        </Select>
        {importTopicId === "__new__" && (
          <Input
            placeholder="输入新主题名称..."
            value={importNewTopicName}
            onChange={(e) => setImportNewTopicName(e.target.value)}
            className="mt-2 h-8 rounded-lg border-black/10 bg-white/60 backdrop-blur-sm text-[13px] placeholder:text-[#bbb] focus-visible:ring-primary/30"
          />
        )}
      </div>
    );
  };

  return (
    <div className="p-6 max-w-xl mx-auto space-y-5">
      <GlassDistortionSVG />
      <LiquidGlassCard className="p-6">
        {/* Header */}
        <h2
          className="text-foreground mb-1"
          style={{ fontSize: "18px", fontWeight: 500, letterSpacing: "-0.4px", lineHeight: "28px" }}
        >
          {isAppendUI ? `追加采集：${createdTopic.name}` : "添加内容到知识库"}
        </h2>
        {!isAppendUI && (
          <p className="text-[12px] text-[#999] mb-4">
            通过关键词自动采集，或粘贴链接精准导入视频和创作者
          </p>
        )}

        {/* Tab bar */}
        {!isAppendUI && !collecting && (
          <div className="flex gap-1 mb-4 border-b border-black/[.06]">
            {TABS.map(({ key, label, icon: Icon }) => (
              <button
                key={key}
                onClick={() => { setMode(key); setImportResult(null); setImportUrl(""); setConflictTopic(null); }}
                className={`flex items-center gap-1.5 px-3 py-2 text-[13px] font-[450] border-b-2 transition-colors -mb-px ${
                  mode === key
                    ? "border-primary text-primary"
                    : "border-transparent text-[#999] hover:text-foreground"
                }`}
              >
                <Icon className="size-3.5" strokeWidth={1.5} />
                {label}
              </button>
            ))}
          </div>
        )}

        {/* ===== Tab: Keyword Collect ===== */}
        {(mode === "keyword" || isAppendUI) && !done && (
          <div className="space-y-4">
            {!isAppendUI && (
              <div>
                <label className="mb-1.5 block text-[13px]" style={{ color: "oklch(0.2642 0.013 93.9 / 0.65)" }}>
                  主题名称
                </label>
                <Input
                  placeholder="例如：量化交易、跨境电商、AI 编程..."
                  value={name}
                  onChange={(e) => { setName(e.target.value); if (conflictTopic) setConflictTopic(null); }}
                  disabled={collecting}
                  className="h-9 rounded-lg border-black/10 bg-white/60 backdrop-blur-sm text-[13px] placeholder:text-[#bbb] focus-visible:ring-primary/30"
                />
              </div>
            )}

            {conflictTopic && (
              <div className="rounded-lg border border-amber-300/40 bg-amber-50/30 p-4">
                <div className="flex items-start gap-2.5">
                  <AlertCircle className="size-4 text-amber-600 mt-0.5 shrink-0" strokeWidth={1.5} />
                  <div className="flex-1 min-w-0">
                    <p className="text-[13px] font-medium text-foreground">已有同名主题「{conflictTopic.name}」</p>
                    <p className="text-[11px] text-[#999] mt-0.5">
                      {conflictTopic.videoCount} 个视频 · {conflictTopic.creatorCount} 位创作者
                      {conflictTopic.videoCount > 0 && <> · {Math.round((conflictTopic.transcribedCount / conflictTopic.videoCount) * 100)}% 已转录</>}
                    </p>
                    <div className="flex gap-2 mt-3">
                      <button onClick={handleAppendExisting} className="flex items-center gap-1.5 rounded-lg bg-primary text-white px-3 py-1.5 text-[12px] font-medium hover:opacity-90 transition-opacity">
                        <FolderSync className="size-3" strokeWidth={1.5} />追加采集
                      </button>
                      <button onClick={handleForceCreate} className="flex items-center gap-1.5 rounded-lg border border-black/10 bg-white/60 px-3 py-1.5 text-[12px] font-medium text-foreground/70 hover:bg-white/80 transition-colors">
                        <FolderPlus className="size-3" strokeWidth={1.5} />仍然创建新主题
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            )}

            <div>
              <label className="mb-1.5 block text-[13px]" style={{ color: "oklch(0.2642 0.013 93.9 / 0.65)" }}>平台选择</label>
              <div className="flex gap-2">
                {(["bilibili", "youtube"] as Platform[]).map((p) => (
                  <button
                    key={p}
                    onClick={() => togglePlatform(p)}
                    disabled={collecting}
                    className={`flex items-center rounded-lg px-3 py-1.5 text-[13px] font-medium transition-colors disabled:opacity-50 ${
                      platforms.includes(p) ? "bg-primary text-white" : "border border-black/10 bg-white/60 backdrop-blur-sm text-foreground hover:bg-white/80"
                    }`}
                  >
                    {p === "bilibili" ? "B站" : "YouTube"}
                  </button>
                ))}
              </div>
            </div>

            {!isAppendUI && (
              <div>
                <button onClick={() => setShowAdvanced(!showAdvanced)} className="flex items-center gap-1 text-[12px] font-[450] text-[#999] transition-colors hover:text-[#555]">
                  {showAdvanced ? <ChevronUp className="size-3" strokeWidth={1.5} /> : <ChevronDown className="size-3" strokeWidth={1.5} />}
                  采集规模（影响耗时）
                </button>
                {showAdvanced && (
                  <div className="mt-3 space-y-3">
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className="text-[11px] text-[#999] mb-1 block">最大创作者数</label>
                        <Input type="number" value={maxCreators} onChange={(e) => setMaxCreators(Math.max(1, Number(e.target.value)))} min={1} max={50} disabled={collecting} className="h-8 rounded-lg border-black/10 text-[13px]" />
                      </div>
                      <div>
                        <label className="text-[11px] text-[#999] mb-1 block">每人最大视频数</label>
                        <Input type="number" value={maxVideos} onChange={(e) => setMaxVideos(Math.max(0, Number(e.target.value)))} min={0} max={200} placeholder="0 = 不限" disabled={collecting} className="h-8 rounded-lg border-black/10 text-[13px]" />
                        <span className="text-[10px] text-[#bbb] mt-0.5 block">0 表示不限制</span>
                      </div>
                    </div>
                    <p className="text-[11px] text-[#aaa] leading-relaxed">
                      预估采集量：约 {maxCreators} 位创作者 × {maxVideos > 0 ? `${maxVideos} 条视频` : "不限视频数"} ≈ {maxVideos > 0 ? `${maxCreators * maxVideos} 条以内` : `${maxCreators * 20}+ 条`}
                    </p>
                  </div>
                )}
              </div>
            )}

            {!conflictTopic && (
              <Button onClick={startCollect} disabled={collecting} className="w-full rounded-lg text-[13px] font-medium">
                {collecting ? <><Loader2 className="size-4 animate-spin" />采集中...</> : <>
                  {isAppendUI ? <FolderSync className="size-4" strokeWidth={1.5} /> : <Download className="size-4" strokeWidth={1.5} />}
                  {isAppendUI ? "开始追加采集" : "开始采集"}
                </>}
              </Button>
            )}
          </div>
        )}

        {/* ===== Tab: Import Video ===== */}
        {mode === "video" && !isAppendUI && !collecting && !done && (
          <div className="space-y-3">
            <p className="text-[12px] text-[#999]">粘贴 B站 或 YouTube 视频链接，将单个视频添加到主题</p>
            {renderTopicSelector()}
            <div className="flex gap-2">
              <Input
                placeholder="https://bilibili.com/video/BV... 或 youtube.com/watch?v=..."
                value={importUrl}
                onChange={(e) => { setImportUrl(e.target.value); setImportResult(null); }}
                onKeyDown={(e) => e.key === "Enter" && handleImportVideo()}
                disabled={importing}
                className="flex-1 h-8 rounded-lg border-black/10 bg-white/60 backdrop-blur-sm text-[13px] placeholder:text-[#bbb] focus-visible:ring-primary/30"
              />
              <button
                onClick={handleImportVideo}
                disabled={importing || !importUrl.trim() || (!createdTopic && !importTopicId)}
                className="shrink-0 h-8 px-3 rounded-lg bg-primary text-white text-[12px] font-medium hover:opacity-90 transition-opacity disabled:opacity-50 flex items-center gap-1"
              >
                {importing ? <><Loader2 className="size-3 animate-spin" />导入中</> : <><Plus className="size-3" strokeWidth={2} />导入</>}
              </button>
            </div>
            {importResult?.ok && (
              <div className="flex items-center gap-2 text-[12px] text-positive">
                <CheckCircle2 className="size-3.5" strokeWidth={1.5} />
                <span>已导入「{importResult.title}」（{importResult.creator}）</span>
              </div>
            )}
          </div>
        )}

        {/* ===== Tab: Import Creator ===== */}
        {mode === "creator" && !isAppendUI && !collecting && !done && (
          <div className="space-y-3">
            <p className="text-[12px] text-[#999]">粘贴 B站空间链接 或 YouTube 频道链接，批量导入创作者的视频</p>
            {renderTopicSelector()}
            <div className="flex items-center gap-2 mb-1">
              <label className="text-[12px] text-[#999] shrink-0">最多导入</label>
              <Input
                type="number" value={importMaxVideos}
                onChange={(e) => setImportMaxVideos(Math.max(1, Math.min(200, Number(e.target.value))))}
                min={1} max={200}
                className="w-20 h-7 rounded-lg border-black/10 text-[12px] text-center"
              />
              <span className="text-[12px] text-[#999]">个视频</span>
            </div>
            <div className="flex gap-2">
              <Input
                placeholder="https://space.bilibili.com/12345 或 youtube.com/@channel"
                value={importUrl}
                onChange={(e) => { setImportUrl(e.target.value); setImportResult(null); }}
                onKeyDown={(e) => e.key === "Enter" && handleImportCreator()}
                disabled={importing}
                className="flex-1 h-8 rounded-lg border-black/10 bg-white/60 backdrop-blur-sm text-[13px] placeholder:text-[#bbb] focus-visible:ring-primary/30"
              />
              <button
                onClick={handleImportCreator}
                disabled={importing || !importUrl.trim() || (!createdTopic && !importTopicId)}
                className="shrink-0 h-8 px-3 rounded-lg bg-primary text-white text-[12px] font-medium hover:opacity-90 transition-opacity disabled:opacity-50 flex items-center gap-1"
              >
                {importing ? <><Loader2 className="size-3 animate-spin" />导入中</> : <><Plus className="size-3" strokeWidth={2} />导入</>}
              </button>
            </div>
            {importResult?.ok && (
              <div className="flex items-center gap-2 text-[12px] text-positive">
                <CheckCircle2 className="size-3.5" strokeWidth={1.5} />
                <span>已导入 {importResult.creator} 的 {importResult.videoCount} 个视频</span>
              </div>
            )}
          </div>
        )}

        {/* ===== Progress Panel (inside the card) ===== */}
        {(collecting || done) && (
          <div className={`${(mode === "keyword" || isAppendUI) && !done ? "mt-5 pt-5 border-t border-black/[.06]" : ""}`}>
            <div className="flex items-center gap-2 mb-3">
              {taskStatus === "done" ? (
                <CheckCircle2 className="size-4 text-positive" strokeWidth={1.5} />
              ) : isCancelled ? (
                <XCircle className="size-4 text-[#aaa]" strokeWidth={1.5} />
              ) : taskStatus === "failed" ? (
                <AlertCircle className="size-4 text-destructive" strokeWidth={1.5} />
              ) : (
                <Loader2 className="size-4 animate-spin text-primary" />
              )}
              <span className="text-[14px] font-medium text-foreground">
                {taskStatus === "done" ? "采集完成"
                  : isCancelled ? "已取消"
                  : taskStatus === "failed" ? "采集失败"
                  : appendMode ? "追加采集进度" : "采集进度"}
              </span>
            </div>

            <Progress value={progress} className="h-1 mb-2" />
            <div className="flex justify-between items-center text-[11px] text-[#999]">
              <span className="flex-1 truncate">{message}</span>
              <span className="shrink-0 ml-2">{progress}%</span>
            </div>

            {collecting && (
              <button onClick={cancelTask} className="mt-2.5 flex items-center gap-1 rounded-md border border-destructive/20 bg-destructive/5 px-2.5 py-1 text-[11px] font-medium text-destructive transition-colors hover:bg-destructive/10">
                <StopCircle className="size-3" strokeWidth={1.5} />停止任务
              </button>
            )}

            {done && taskStatus === "done" && (
              <div className="flex gap-2 pt-4 mt-3 border-t border-black/[.06]">
                <Link
                  href={createdTopic ? `/explore?topicId=${createdTopic.id}` : "/explore"}
                  onClick={() => { if (createdTopic) selectTopic({ id: createdTopic.id, name: createdTopic.name } as Topic); }}
                >
                  <button className="flex items-center gap-1.5 rounded-lg border border-black/10 bg-white/60 backdrop-blur-sm px-3 py-1.5 text-[13px] font-medium text-foreground transition-colors hover:bg-white/80">
                    <Library className="size-3.5" strokeWidth={1.5} />查看结果
                  </button>
                </Link>
                <Link
                  href="/chat"
                  onClick={() => { if (createdTopic) selectTopic({ id: createdTopic.id, name: createdTopic.name } as Topic); }}
                >
                  <Button className="rounded-lg h-auto py-1.5 px-3 text-[13px] font-medium">
                    <MessageSquare className="size-3.5" strokeWidth={1.5} />开始提问
                  </Button>
                </Link>
              </div>
            )}

            {done && taskStatus === "failed" && (
              <div className="flex gap-2 pt-4 mt-3 border-t border-black/[.06]">
                {!isCancelled && createdTopic && (
                  <Link href={`/collect?topicId=${createdTopic.id}&mode=append`}>
                    <button className="flex items-center gap-1.5 rounded-lg border border-black/10 bg-white/60 px-3 py-1.5 text-[12px] font-medium text-foreground/70 hover:bg-white/80 transition-colors">
                      <RefreshCw className="size-3" strokeWidth={1.5} />重新采集
                    </button>
                  </Link>
                )}
                <button onClick={resetAll} className="flex items-center gap-1.5 rounded-lg border border-black/10 bg-white/60 px-3 py-1.5 text-[12px] font-medium text-foreground/70 hover:bg-white/80 transition-colors">
                  <FolderPlus className="size-3" strokeWidth={1.5} />新建采集
                </button>
              </div>
            )}
          </div>
        )}
      </LiquidGlassCard>
    </div>
  );
}

export default function CollectPage() {
  return (
    <Suspense fallback={
      <div className="p-6 max-w-xl mx-auto">
        <GlassDistortionSVG />
        <LiquidGlassCard className="p-6">
          <div className="flex items-center justify-center py-8">
            <Loader2 className="size-5 animate-spin text-primary" />
          </div>
        </LiquidGlassCard>
      </div>
    }>
      <CollectContent />
    </Suspense>
  );
}
