"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  Video,
  Mic,
  Users,
  FolderOpen,
  Plus,
  MessageSquare,
  ChevronRight,
  LayoutGrid,
  FolderSync,
} from "lucide-react";
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip } from "recharts";

import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import { GlassDistortionSVG, LiquidGlassCard } from "@/components/ui/liquid-glass";
import type { DashboardStats, Topic } from "@/lib/types";

const STATUS_LABEL: Record<string, string> = {
  idle: "空闲",
  collecting: "采集中",
  transcribing: "转录中",
  done: "完成",
  error: "错误",
};

export default function DashboardPage() {
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/stats")
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then(setStats)
      .catch((e) => setError(e instanceof Error ? e.message : "加载失败"))
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <DashboardSkeleton />;
  if (error) return <ErrorState message={error} />;
  if (!stats || stats.totalTopics === 0) return <EmptyState />;

  const pieData = [
    { name: "B站", value: stats.platformBreakdown.bilibili },
    { name: "YouTube", value: stats.platformBreakdown.youtube },
  ].filter((d) => d.value > 0);

  return (
    <div className="p-6 space-y-6 max-w-6xl dashboard-bg min-h-full">
      <GlassDistortionSVG />

      {/* Stat Cards */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard icon={Video} label="视频总数" value={stats.totalVideos} />
        <StatCard
          icon={Mic}
          label="已转录"
          value={stats.totalTranscribed}
          sub={`${stats.transcriptionRate}%`}
          actionLabel={stats.transcriptionRate < 100 ? "完成转录" : undefined}
          actionHref={stats.transcriptionRate < 100 ? "/explore" : undefined}
        />
        <StatCard icon={Users} label="创作者" value={stats.totalCreators} />
        <StatCard icon={FolderOpen} label="主题数" value={stats.totalTopics} />
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        {/* Platform Distribution */}
        <LiquidGlassCard className="p-5">
          <h3
            className="text-foreground mb-4"
            style={{ fontSize: "18px", fontWeight: 500, letterSpacing: "-0.4px", lineHeight: "28px" }}
          >
            平台分布
          </h3>

          {pieData.length > 0 ? (
            <div className="flex flex-col items-center gap-3">
              <div className="flex flex-wrap gap-x-4 gap-y-1.5 justify-center">
                {pieData.map((d, idx) => {
                  const total = pieData.reduce((s, x) => s + x.value, 0);
                  const pct = total > 0 ? ((d.value / total) * 100).toFixed(1) : "0";
                  const labelColors = ["#6366F1", "#06B6D4"];
                  return (
                    <div key={d.name} className="flex items-center gap-2">
                      <span
                        className="size-2 rounded-full shrink-0"
                        style={{ background: labelColors[idx] }}
                      />
                      <span
                        className="font-medium"
                        style={{ fontSize: "14px", letterSpacing: "-0.4px", lineHeight: "20px", color: labelColors[idx] }}
                      >
                        {d.name}
                      </span>
                      <span
                        className="font-medium text-foreground ml-1"
                        style={{ fontSize: "14px", letterSpacing: "-0.4px", lineHeight: "20px" }}
                      >
                        {pct}%
                      </span>
                    </div>
                  );
                })}
              </div>

              <div className="w-full aspect-square max-w-[180px]" style={{ filter: "drop-shadow(0 8px 24px rgba(99,102,241,.18)) drop-shadow(0 2px 8px rgba(6,182,212,.12))" }}>
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <defs>
                      <linearGradient id="grad-seg-0" x1="0" y1="0" x2="1" y2="1">
                        <stop offset="0%" stopColor="#D8E0F2" />
                        <stop offset="100%" stopColor="#EEEEFC" />
                      </linearGradient>
                      <linearGradient id="grad-seg-1" x1="0" y1="0" x2="1" y2="1">
                        <stop offset="0%" stopColor="#E0ECFC" />
                        <stop offset="100%" stopColor="#EEF4FA" />
                      </linearGradient>
                    </defs>
                    <Pie
                      data={pieData}
                      cx="50%"
                      cy="50%"
                      innerRadius="52%"
                      outerRadius="85%"
                      dataKey="value"
                      strokeWidth={3}
                      stroke="rgba(255,255,255,.7)"
                      paddingAngle={3}
                    >
                      {pieData.map((_, idx) => (
                        <Cell key={idx} fill={`url(#grad-seg-${idx})`} />
                      ))}
                    </Pie>
                    <Tooltip
                      contentStyle={{
                        background: "rgba(255,255,255,.75)",
                        backdropFilter: "blur(12px)",
                        border: "1px solid rgba(255,255,255,.6)",
                        borderRadius: "10px",
                        fontSize: "12px",
                        boxShadow: "0 4px 16px rgba(0,0,0,.08)",
                      }}
                    />
                  </PieChart>
                </ResponsiveContainer>
              </div>
            </div>
          ) : (
            <div
              className="flex h-[160px] items-center justify-center"
              style={{ fontSize: "14px", letterSpacing: "-0.4px", lineHeight: "20px", color: "oklch(0.2642 0.013 93.9 / 0.65)" }}
            >
              暂无数据
            </div>
          )}
        </LiquidGlassCard>

        {/* Recent Topics */}
        <LiquidGlassCard className="lg:col-span-2 p-5">
          <div className="flex items-center justify-between mb-4">
            <h3
              className="text-foreground"
              style={{ fontSize: "18px", fontWeight: 500, letterSpacing: "-0.4px", lineHeight: "28px" }}
            >
              最近主题
            </h3>
            <Link href="/collect">
              <button
                className="flex items-center gap-1 rounded-lg border border-white/40 bg-white/30 backdrop-blur-sm px-2.5 py-1 transition-colors hover:bg-white/50"
                style={{ fontSize: "14px", fontWeight: 500, letterSpacing: "-0.4px", lineHeight: "28px", color: "oklch(0.2642 0.013 93.9)" }}
              >
                <Plus className="size-3.5" strokeWidth={1.5} />
                新建
              </button>
            </Link>
          </div>

          {stats.recentTopics.length > 0 ? (
            <div className="space-y-2">
              {stats.recentTopics.map((topic: Topic) => {
                const rate =
                  topic.videoCount > 0
                    ? Math.round((topic.transcribedCount / topic.videoCount) * 100)
                    : 0;
                return (
                  <div key={topic.id} className="group flex items-center justify-between rounded-lg border border-white/30 bg-white/20 backdrop-blur-sm px-4 py-3 transition-all hover:bg-white/40 hover:border-white/50">
                    <Link href={`/explore?topicId=${topic.id}`} className="flex-1 min-w-0">
                      <div className="space-y-0.5">
                        <div className="flex items-center gap-2">
                          <span
                            className="text-foreground"
                            style={{ fontSize: "14px", fontWeight: 500, letterSpacing: "-0.4px", lineHeight: "20px" }}
                          >
                            {topic.name}
                          </span>
                          <span
                            className={`inline-block rounded px-1.5 py-0.5 text-[10px] font-medium ${
                              topic.status === "done"
                                ? "bg-positive/10 text-positive"
                                : topic.status === "error"
                                ? "bg-destructive/10 text-destructive"
                                : "bg-black/[.04] text-[#888]"
                            }`}
                          >
                            {STATUS_LABEL[topic.status] || topic.status}
                          </span>
                        </div>
                        <p style={{ fontSize: "13px", letterSpacing: "-0.4px", lineHeight: "20px", color: "oklch(0.2642 0.013 93.9 / 0.65)" }}>
                          {topic.videoCount} 视频 · {topic.creatorCount} 创作者 · {rate}% 已转录
                        </p>
                      </div>
                    </Link>
                    <div className="flex items-center gap-3">
                      <div className="w-28">
                        <div className="flex items-center justify-between text-[10px] text-[#aaa] mb-1">
                          <span>转录</span>
                          <span>{rate}%</span>
                        </div>
                        <Progress value={rate} className="h-1" />
                      </div>
                      <Link
                        href={`/collect?topicId=${topic.id}&mode=append`}
                        onClick={(e) => e.stopPropagation()}
                        className="flex items-center justify-center size-7 rounded-md border border-black/10 bg-white/40 text-foreground/50 hover:bg-white/70 hover:text-foreground/80 transition-colors"
                        title="追加采集"
                      >
                        <FolderSync className="size-3.5" strokeWidth={1.5} />
                      </Link>
                      <Link href={`/explore?topicId=${topic.id}`}>
                        <ChevronRight
                          className="size-3.5 text-[#ccc] transition-colors group-hover:text-[#999]"
                          strokeWidth={1.5}
                        />
                      </Link>
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <div
              className="flex h-28 items-center justify-center"
              style={{ fontSize: "14px", letterSpacing: "-0.4px", lineHeight: "20px", color: "oklch(0.2642 0.013 93.9 / 0.65)" }}
            >
              还没有主题，去采集一些吧
            </div>
          )}
        </LiquidGlassCard>
      </div>

      {/* Quick Actions */}
      <div className="flex gap-3">
        <Link href="/collect">
          <LiquidGlassCard className="inline-flex items-center gap-2 rounded-xl px-5 py-2.5 cursor-pointer">
            <Plus className="size-4 text-foreground" strokeWidth={1.5} />
            <span style={{ fontSize: "14px", fontWeight: 500, letterSpacing: "-0.4px", lineHeight: "28px" }}>
              新建知识库
            </span>
          </LiquidGlassCard>
        </Link>
        <Link href="/chat">
          <LiquidGlassCard className="inline-flex items-center gap-2 rounded-xl px-5 py-2.5 cursor-pointer">
            <MessageSquare className="size-4 text-foreground" strokeWidth={1.5} />
            <span style={{ fontSize: "14px", fontWeight: 500, letterSpacing: "-0.4px", lineHeight: "28px" }}>
              开始提问
            </span>
          </LiquidGlassCard>
        </Link>
      </div>
    </div>
  );
}

function StatCard({
  icon: Icon,
  label,
  value,
  sub,
  actionLabel,
  actionHref,
}: {
  icon: React.ComponentType<{ className?: string; strokeWidth?: number }>;
  label: string;
  value: number;
  sub?: string;
  actionLabel?: string;
  actionHref?: string;
}) {
  return (
    <LiquidGlassCard className="px-5 py-4">
      <div className="flex items-center justify-between">
        <div>
          <p style={{ fontSize: "14px", letterSpacing: "-0.4px", lineHeight: "20px", color: "oklch(0.2642 0.013 93.9 / 0.65)" }}>
            {label}
          </p>
          <div className="flex items-baseline gap-2 mt-1">
            <p
              className="text-foreground"
              style={{ fontSize: "18px", fontWeight: 500, letterSpacing: "-0.4px", lineHeight: "28px" }}
            >
              {value.toLocaleString()}
            </p>
            {sub && (
              <span
                className="text-foreground/60"
                style={{ fontSize: "14px", fontWeight: 500, letterSpacing: "-0.4px" }}
              >
                {sub}
              </span>
            )}
          </div>
          {actionLabel && actionHref && (
            <Link href={actionHref} className="text-[11px] text-primary hover:underline mt-1 inline-block">
              {actionLabel} →
            </Link>
          )}
        </div>
        <div className="flex size-9 items-center justify-center rounded-lg bg-white/30 backdrop-blur-sm">
          <Icon className="size-[18px] text-foreground/50" strokeWidth={1.5} />
        </div>
      </div>
    </LiquidGlassCard>
  );
}

function DashboardSkeleton() {
  return (
    <div className="p-6 space-y-6 max-w-6xl dashboard-bg min-h-full">
      <GlassDistortionSVG />
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {[...Array(4)].map((_, i) => (
          <LiquidGlassCard key={i} className="px-5 py-4">
            <Skeleton className="h-3 w-12 mb-2 bg-white/40" />
            <Skeleton className="h-7 w-20 bg-white/40" />
          </LiquidGlassCard>
        ))}
      </div>
    </div>
  );
}

function ErrorState({ message }: { message: string }) {
  return (
    <div className="flex h-full items-center justify-center dashboard-bg">
      <GlassDistortionSVG />
      <LiquidGlassCard className="px-16 py-12 text-center">
        <div className="space-y-3">
          <FolderOpen className="size-10 text-destructive mx-auto" strokeWidth={1.5} />
          <h2
            className="text-foreground"
            style={{ fontSize: "18px", fontWeight: 500, letterSpacing: "-0.4px", lineHeight: "28px" }}
          >
            加载失败
          </h2>
          <p style={{ fontSize: "14px", letterSpacing: "-0.4px", lineHeight: "20px", color: "oklch(0.2642 0.013 93.9 / 0.65)" }}>
            {message}
          </p>
          <button
            onClick={() => window.location.reload()}
            className="rounded-lg border border-white/40 bg-white/30 backdrop-blur-sm px-4 py-2 transition-colors hover:bg-white/50"
            style={{ fontSize: "14px", fontWeight: 500, letterSpacing: "-0.4px", lineHeight: "28px", color: "oklch(0.2642 0.013 93.9)" }}
          >
            重试
          </button>
        </div>
      </LiquidGlassCard>
    </div>
  );
}

function EmptyState() {
  return (
    <div className="flex h-full items-center justify-center dashboard-bg">
      <GlassDistortionSVG />
      <LiquidGlassCard className="px-16 py-12 text-center">
        <div className="space-y-3">
          <LayoutGrid className="size-8 text-foreground/60 mx-auto" strokeWidth={1.5} />
          <h2
            className="text-foreground"
            style={{ fontSize: "18px", fontWeight: 500, letterSpacing: "-0.4px", lineHeight: "28px" }}
          >
            还没有知识库
          </h2>
          <p style={{ fontSize: "14px", letterSpacing: "-0.4px", lineHeight: "20px", color: "oklch(0.2642 0.013 93.9 / 0.65)" }}>
            创建知识库来整理你的视频研究
          </p>
          <Link href="/collect">
            <button
              className="inline-flex items-center gap-1.5 rounded-lg border border-white/40 bg-white/30 backdrop-blur-sm px-4 py-2 transition-colors hover:bg-white/50 mt-2"
              style={{ fontSize: "14px", fontWeight: 500, letterSpacing: "-0.4px", lineHeight: "28px", color: "oklch(0.2642 0.013 93.9)" }}
            >
              <Plus className="size-4" strokeWidth={1.5} />
              新建知识库
            </button>
          </Link>
        </div>
      </LiquidGlassCard>
    </div>
  );
}
