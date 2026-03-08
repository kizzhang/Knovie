"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import Link from "next/link";
import {
  ListChecks,
  Loader2,
  CheckCircle2,
  AlertCircle,
  Clock,
  RotateCcw,
  ExternalLink,
  StopCircle,
  FolderSync,
  XCircle,
} from "lucide-react";
import { toast } from "sonner";
import { Progress } from "@/components/ui/progress";
import { GlassDistortionSVG, LiquidGlassCard } from "@/components/ui/liquid-glass";

interface TaskItem {
  id: string;
  topicId: string;
  topicName: string;
  type: string;
  status: string;
  progress: number;
  message?: string;
  errorMsg?: string;
  createdAt: string;
  updatedAt: string;
}

const STATUS_CONFIG: Record<string, { icon: typeof CheckCircle2; label: string; color: string }> = {
  done: { icon: CheckCircle2, label: "已完成", color: "text-positive" },
  failed: { icon: AlertCircle, label: "失败", color: "text-destructive" },
  cancelled: { icon: XCircle, label: "已取消", color: "text-[#aaa]" },
  running: { icon: Loader2, label: "进行中", color: "text-primary" },
  pending: { icon: Clock, label: "等待中", color: "text-[#aaa]" },
};

export default function TasksPage() {
  const [tasks, setTasks] = useState<TaskItem[]>([]);
  const [loading, setLoading] = useState(true);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchTasks = useCallback(async () => {
    try {
      const res = await fetch("/api/tasks?limit=30");
      if (res.ok) {
        const data = await res.json();
        setTasks(data);
      }
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchTasks();
    pollRef.current = setInterval(fetchTasks, 5000);
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [fetchTasks]);

  const hasRunning = tasks.some((t) => t.status === "running" || t.status === "pending");

  const cancelTask = async (taskId: string) => {
    try {
      const res = await fetch(`/api/collect/${taskId}/cancel`, { method: "POST" });
      if (res.ok) {
        toast.info("任务已取消");
        fetchTasks();
      } else {
        toast.error("取消失败");
      }
    } catch {
      toast.error("取消失败");
    }
  };

  const formatTime = (iso: string) => {
    try {
      const diff = Date.now() - new Date(iso).getTime();
      const mins = Math.floor(diff / 60000);
      if (mins < 1) return "刚刚";
      if (mins < 60) return `${mins}分钟前`;
      const hrs = Math.floor(mins / 60);
      if (hrs < 24) return `${hrs}小时前`;
      const days = Math.floor(hrs / 24);
      if (days < 7) return `${days}天前`;
      const d = new Date(iso);
      return `${d.getMonth() + 1}月${d.getDate()}日 ${d.getHours().toString().padStart(2, "0")}:${d.getMinutes().toString().padStart(2, "0")}`;
    } catch {
      return iso;
    }
  };

  return (
    <div className="p-6 max-w-3xl mx-auto space-y-5">
      <GlassDistortionSVG />
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <ListChecks className="size-[18px] text-foreground/60" strokeWidth={1.5} />
          <h2
            className="text-foreground"
            style={{ fontSize: "18px", fontWeight: 500, letterSpacing: "-0.4px", lineHeight: "28px" }}
          >
            任务中心
          </h2>
        </div>
        {hasRunning && (
          <span className="flex items-center gap-1.5 text-[12px] text-primary">
            <Loader2 className="size-3 animate-spin" />
            有任务正在运行
          </span>
        )}
      </div>

      {loading ? (
        <div className="space-y-3">
          {[...Array(3)].map((_, i) => (
            <LiquidGlassCard key={i} className="p-4">
              <div className="h-4 w-1/3 rounded bg-black/[.04] animate-pulse" />
              <div className="h-3 w-2/3 rounded bg-black/[.04] animate-pulse mt-2" />
            </LiquidGlassCard>
          ))}
        </div>
      ) : tasks.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 text-center">
          <ListChecks className="size-10 text-[#ccc] mb-3" strokeWidth={1.5} />
          <h3
            className="text-foreground"
            style={{ fontSize: "18px", fontWeight: 500, letterSpacing: "-0.4px", lineHeight: "28px" }}
          >
            暂无任务
          </h3>
          <p className="mt-1 text-[14px] text-[#999]">
            去采集页面创建主题并开始采集
          </p>
          <Link href="/collect" className="mt-4">
            <button className="rounded-lg bg-primary text-white px-4 py-1.5 text-[14px] font-medium hover:opacity-90 transition-opacity">
              去采集
            </button>
          </Link>
        </div>
      ) : (
        <div className="space-y-2.5">
          {tasks.map((task) => {
            const isCancelled = task.status === "failed" && (task.errorMsg?.includes("取消") || task.message?.includes("取消"));
            const effectiveStatus = isCancelled ? "cancelled" : task.status;
            const cfg = STATUS_CONFIG[effectiveStatus] || STATUS_CONFIG.pending;
            const Icon = cfg.icon;
            const isRunning = task.status === "running";
            return (
              <LiquidGlassCard key={task.id} className="p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-center gap-2 min-w-0">
                    <Icon
                      className={`size-4 shrink-0 ${cfg.color} ${isRunning ? "animate-spin" : ""}`}
                      strokeWidth={1.5}
                    />
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-[14px] font-medium text-foreground truncate">
                          {task.topicName || task.topicId}
                        </span>
                        <span className={`text-[11px] ${cfg.color}`}>{cfg.label}</span>
                      </div>
                      <div className="text-[11px] text-[#aaa] mt-0.5">
                        {task.type === "scrape" ? "采集 + 转录" : task.type === "transcribe" ? "转录" : task.type} · {formatTime(task.createdAt)}
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0">
                    {task.status === "done" && (
                      <>
                        <Link
                          href={`/explore?topicId=${task.topicId}`}
                          className="flex items-center gap-1 rounded-md border border-black/10 bg-white/60 px-2 py-1 text-[11px] text-foreground/70 hover:bg-white/80 transition-colors"
                        >
                          <ExternalLink className="size-2.5" strokeWidth={1.5} />
                          查看
                        </Link>
                        <Link
                          href={`/collect?topicId=${task.topicId}&mode=append`}
                          className="flex items-center gap-1 rounded-md border border-primary/20 bg-primary/5 px-2 py-1 text-[11px] text-primary hover:bg-primary/10 transition-colors"
                        >
                          <FolderSync className="size-2.5" strokeWidth={1.5} />
                          追加采集
                        </Link>
                      </>
                    )}
                    {(task.status === "running" || task.status === "pending") && (
                      <button
                        onClick={() => cancelTask(task.id)}
                        className="flex items-center gap-1 rounded-md border border-destructive/20 bg-destructive/5 px-2 py-1 text-[11px] text-destructive hover:bg-destructive/10 transition-colors"
                      >
                        <StopCircle className="size-2.5" strokeWidth={1.5} />
                        停止
                      </button>
                    )}
                    {task.status === "failed" && !isCancelled && (
                      <Link
                        href={`/collect?topicId=${task.topicId}&mode=append`}
                        className="flex items-center gap-1 rounded-md border border-destructive/20 bg-destructive/5 px-2 py-1 text-[11px] text-destructive hover:bg-destructive/10 transition-colors"
                      >
                        <RotateCcw className="size-2.5" strokeWidth={1.5} />
                        重新采集
                      </Link>
                    )}
                    {isCancelled && (
                      <Link
                        href={`/collect?topicId=${task.topicId}&mode=append`}
                        className="flex items-center gap-1 rounded-md border border-black/10 bg-white/60 px-2 py-1 text-[11px] text-foreground/70 hover:bg-white/80 transition-colors"
                      >
                        <RotateCcw className="size-2.5" strokeWidth={1.5} />
                        重试
                      </Link>
                    )}
                  </div>
                </div>

                {(isRunning || task.status === "pending") && (
                  <div className="mt-2.5">
                    <Progress value={Math.round(task.progress * 100)} className="h-1" />
                    <div className="flex justify-between mt-1 text-[10px] text-[#aaa]">
                      <span>{task.message || "准备中..."}</span>
                      <span>{Math.round(task.progress * 100)}%</span>
                    </div>
                  </div>
                )}

                {task.status === "done" && task.message && (
                  <p className="mt-1.5 text-[11px] text-[#999]">{task.message}</p>
                )}

                {task.status === "failed" && task.errorMsg && (
                  <p className="mt-1.5 text-[11px] text-destructive/80 line-clamp-2">{task.errorMsg}</p>
                )}
              </LiquidGlassCard>
            );
          })}
        </div>
      )}
    </div>
  );
}
