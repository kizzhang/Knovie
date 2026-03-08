"use client";

import { useEffect, useState } from "react";
import {
  Settings,
  CheckCircle2,
  AlertCircle,
  RefreshCw,
  Loader2,
  ExternalLink,
} from "lucide-react";
import { GlassDistortionSVG, LiquidGlassCard } from "@/components/ui/liquid-glass";

interface HealthCheck {
  ok: boolean;
  label: string;
  hint?: string;
}

interface HealthResult {
  ok: boolean;
  checks: Record<string, HealthCheck>;
}

const SETUP_GUIDES: Record<string, { steps: string; url?: string; linkLabel?: string; note?: string }> = {
  gemini: {
    steps: "在 .env.local 中填写 GOOGLE_GENERATIVE_AI_API_KEY，用于 AI 问答功能。",
    url: "https://aistudio.google.com/apikey",
    linkLabel: "前往 Google AI Studio 获取 API Key",
    note: "免费额度即可使用，无需绑卡。",
  },
  groq: {
    steps: "在 .env.local 中填写 GROQ_API_KEY，用于语音转录（Whisper）。未配置时将使用平台自带字幕。",
    url: "https://console.groq.com/keys",
    linkLabel: "前往 Groq Console 获取 API Key",
    note: "免费层级每天可转录约 2 小时音频。",
  },
  serper: {
    steps: "在 .env.local 中填写 SERPER_API_KEY，让 AI 能搜索互联网获取最新信息。",
    url: "https://serper.dev/signup",
    linkLabel: "前往 Serper 注册获取 API Key",
    note: "注册即送 2500 次免费搜索额度。",
  },
  ytdlp: {
    steps: "需要在服务器上安装视频下载工具，用于下载视频音频进行转录。",
    url: "https://github.com/yt-dlp/yt-dlp#installation",
    linkLabel: "查看安装方法",
    note: "推荐使用 pip install yt-dlp 安装。",
  },
  bilibili: {
    steps: "需安装 Python 采集模块。如需完整功能，在 .env.local 中填写 BILIBILI_SESSDATA（Cookie）。",
    url: "https://www.bilibili.com",
    linkLabel: "如何获取 SESSDATA",
    note: "浏览器登录 B站 → F12 打开开发者工具 → Application → Cookies → 复制 SESSDATA 的值。",
  },
  db: {
    steps: "数据库连接异常，请检查后端服务是否正常启动。",
  },
  backend: {
    steps: "后端服务未启动或端口不正确，请在终端运行 backend 启动命令。",
  },
};

export default function SettingsPage() {
  const [health, setHealth] = useState<HealthResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchHealth = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/health");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setHealth(await res.json());
    } catch (e) {
      setError(e instanceof Error ? e.message : "连接失败");
      setHealth(null);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchHealth();
  }, []);

  const checks = health?.checks ? Object.entries(health.checks) : [];

  return (
    <div className="p-6 max-w-2xl mx-auto space-y-5">
      <GlassDistortionSVG />
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <Settings className="size-[18px] text-foreground/60" strokeWidth={1.5} />
          <h2
            className="text-foreground"
            style={{ fontSize: "18px", fontWeight: 500, letterSpacing: "-0.4px", lineHeight: "28px" }}
          >
            设置与自检
          </h2>
        </div>
        <button
          onClick={fetchHealth}
          disabled={loading}
          className="flex items-center gap-1 rounded-lg border border-black/10 bg-white/60 px-2.5 py-1 text-[12px] font-[450] text-foreground/70 transition-colors hover:bg-white/80 disabled:opacity-50"
        >
          <RefreshCw className={`size-3 ${loading ? "animate-spin" : ""}`} strokeWidth={1.5} />
          重新检测
        </button>
      </div>

      {error && (
        <LiquidGlassCard className="p-4">
          <div className="flex items-center gap-2 text-destructive">
            <AlertCircle className="size-4" strokeWidth={1.5} />
            <div>
              <p className="text-[14px] font-medium">无法连接后端服务</p>
              <p className="text-[12px] text-destructive/70 mt-0.5">
                请确认后端服务已启动并运行在正确的端口。错误：{error}
              </p>
            </div>
          </div>
        </LiquidGlassCard>
      )}

      {loading && !health && (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="size-5 animate-spin text-[#aaa]" />
        </div>
      )}

      {health && (
        <>
          <LiquidGlassCard className="p-4">
            <div className="flex items-center gap-2 mb-1">
              {health.ok ? (
                <CheckCircle2 className="size-4 text-positive" strokeWidth={1.5} />
              ) : (
                <AlertCircle className="size-4 text-amber-500" strokeWidth={1.5} />
              )}
              <span className="text-[14px] font-medium text-foreground">
                {health.ok ? "所有服务正常" : "部分服务需要配置"}
              </span>
            </div>
            <p className="text-[12px] text-[#999] ml-6">
              {health.ok
                ? "系统已准备就绪，可以正常使用所有功能。"
                : "部分功能可能受限，请查看下方详情并按指引配置。"
              }
            </p>
          </LiquidGlassCard>

          <div className="space-y-2">
            {checks.map(([key, check]) => {
              const guide = SETUP_GUIDES[key];
              return (
                <LiquidGlassCard key={key} className="p-3.5">
                  <div className="flex items-start gap-2.5">
                    {check.ok ? (
                      <CheckCircle2 className="size-4 text-positive shrink-0 mt-0.5" strokeWidth={1.5} />
                    ) : (
                      <AlertCircle className="size-4 text-amber-500 shrink-0 mt-0.5" strokeWidth={1.5} />
                    )}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-[13px] font-medium text-foreground">{check.label}</span>
                        <span className={`text-[10px] px-1.5 py-0.5 rounded ${
                          check.ok
                            ? "bg-positive/10 text-positive"
                            : "bg-amber-500/10 text-amber-600"
                        }`}>
                          {check.ok ? "正常" : "待配置"}
                        </span>
                      </div>
                      {check.hint && (
                        <p className="text-[11px] text-[#999] mt-0.5">{check.hint}</p>
                      )}
                      {!check.ok && guide && (
                        <div className="mt-1.5 text-[11px] text-[#777] leading-relaxed space-y-1">
                          <p>{guide.steps}</p>
                          {guide.url && (
                            <a
                              href={guide.url}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="inline-flex items-center gap-1 text-primary hover:underline"
                            >
                              {guide.linkLabel}
                              <ExternalLink className="size-2.5" strokeWidth={1.5} />
                            </a>
                          )}
                          {guide.note && (
                            <p className="text-[10px] text-[#aaa]">{guide.note}</p>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                </LiquidGlassCard>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}
