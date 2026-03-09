"use client";

import { useEffect, useState, useCallback } from "react";
import {
  Settings,
  CheckCircle2,
  AlertCircle,
  RefreshCw,
  Loader2,
  ExternalLink,
  Eye,
  EyeOff,
  Save,
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

interface SettingItem {
  key: string;
  label: string;
  description: string;
  link?: string;
  linkLabel?: string;
  secret: boolean;
  required: boolean;
  default?: string;
  group: string;
  value: string;
  isSet: boolean;
}

export default function SettingsPage() {
  const [health, setHealth] = useState<HealthResult | null>(null);
  const [healthLoading, setHealthLoading] = useState(true);
  const [healthError, setHealthError] = useState<string | null>(null);

  const [settings, setSettings] = useState<SettingItem[]>([]);
  const [settingsLoading, setSettingsLoading] = useState(true);
  const [settingsDisabled, setSettingsDisabled] = useState(false);
  const [editValues, setEditValues] = useState<Record<string, string>>({});
  const [visibleSecrets, setVisibleSecrets] = useState<Set<string>>(new Set());
  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);

  const fetchHealth = useCallback(async () => {
    setHealthLoading(true);
    setHealthError(null);
    try {
      const res = await fetch("/api/health");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setHealth(await res.json());
    } catch (e) {
      setHealthError(e instanceof Error ? e.message : "连接失败");
      setHealth(null);
    } finally {
      setHealthLoading(false);
    }
  }, []);

  const fetchSettings = useCallback(async () => {
    setSettingsLoading(true);
    try {
      const res = await fetch("/api/settings");
      if (res.status === 403) {
        setSettingsDisabled(true);
        return;
      }
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setSettings(data.items);
      const vals: Record<string, string> = {};
      for (const item of data.items) {
        vals[item.key] = item.value;
      }
      setEditValues(vals);
      setDirty(false);
    } catch {
      // settings API might not be available
    } finally {
      setSettingsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchHealth();
    fetchSettings();
  }, [fetchHealth, fetchSettings]);

  const handleChange = (key: string, value: string) => {
    setEditValues((prev) => ({ ...prev, [key]: value }));
    setDirty(true);
    setSaveMsg(null);
  };

  const toggleSecret = (key: string) => {
    setVisibleSecrets((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const handleSave = async () => {
    setSaving(true);
    setSaveMsg(null);
    try {
      const payload: Record<string, string> = {};
      for (const item of settings) {
        const newVal = editValues[item.key] ?? "";
        if (newVal !== item.value) {
          payload[item.key] = newVal;
        }
      }

      if (Object.keys(payload).length === 0) {
        setSaveMsg("没有需要保存的更改");
        setSaving(false);
        return;
      }

      const res = await fetch("/api/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ settings: payload }),
      });

      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setSaveMsg(`已保存 ${data.updated.length} 项配置，重启后端服务后生效`);
      setDirty(false);
      await fetchSettings();
      await fetchHealth();
    } catch (e) {
      setSaveMsg(`保存失败：${e instanceof Error ? e.message : "未知错误"}`);
    } finally {
      setSaving(false);
    }
  };

  const checks = health?.checks ? Object.entries(health.checks) : [];

  const groups = settings.reduce<Record<string, SettingItem[]>>((acc, item) => {
    if (!acc[item.group]) acc[item.group] = [];
    acc[item.group].push(item);
    return acc;
  }, {});

  return (
    <div className="p-6 max-w-2xl mx-auto space-y-6">
      <GlassDistortionSVG />

      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <Settings className="size-[18px] text-foreground/60" strokeWidth={1.5} />
          <h2
            className="text-foreground"
            style={{ fontSize: "18px", fontWeight: 500, letterSpacing: "-0.4px", lineHeight: "28px" }}
          >
            设置
          </h2>
        </div>
      </div>

      {/* Settings Form */}
      {settingsLoading ? (
        <div className="flex items-center justify-center py-8">
          <Loader2 className="size-5 animate-spin text-[#aaa]" />
        </div>
      ) : settingsDisabled ? (
        <LiquidGlassCard className="p-4">
          <div className="flex items-start gap-2.5">
            <AlertCircle className="size-4 text-foreground/40 shrink-0 mt-0.5" strokeWidth={1.5} />
            <div className="space-y-1">
              <p className="text-[13px] font-medium text-foreground/70">配置编辑未启用</p>
              <p className="text-[11px] text-[#999] leading-relaxed">
                出于安全考虑，在线配置编辑默认关闭。本地开发时，在环境变量中设置{" "}
                <code className="px-1 py-0.5 bg-foreground/5 rounded text-[10px] font-mono">SETTINGS_UI_ENABLED=true</code>{" "}
                即可启用。生产环境请通过部署平台（Vercel / Railway）的环境变量面板管理配置。
              </p>
            </div>
          </div>
        </LiquidGlassCard>
      ) : settings.length > 0 ? (
        <>
          {Object.entries(groups).map(([group, items]) => (
            <div key={group} className="space-y-2">
              <h3 className="text-[13px] font-medium text-foreground/60 px-0.5">{group}</h3>
              {items.map((item) => {
                const val = editValues[item.key] ?? "";
                const isMasked = item.secret && item.isSet && val.includes("*");
                return (
                  <LiquidGlassCard key={item.key} className="p-3.5">
                    <div className="space-y-2">
                      <div className="flex items-center gap-2">
                        <span className="text-[13px] font-medium text-foreground">{item.label}</span>
                        {item.required && (
                          <span className="text-[10px] px-1.5 py-0.5 rounded bg-red-500/10 text-red-500">必填</span>
                        )}
                        {item.isSet && (
                          <span className="text-[10px] px-1.5 py-0.5 rounded bg-positive/10 text-positive">已配置</span>
                        )}
                        {!item.isSet && !item.required && (
                          <span className="text-[10px] px-1.5 py-0.5 rounded bg-foreground/5 text-foreground/40">可选</span>
                        )}
                      </div>
                      <p className="text-[11px] text-[#999] leading-relaxed">{item.description}</p>
                      <div className="flex items-center gap-1.5">
                        <div className="relative flex-1">
                          <input
                            type={item.secret && !visibleSecrets.has(item.key) ? "password" : "text"}
                            value={val}
                            onChange={(e) => handleChange(item.key, e.target.value)}
                            placeholder={item.default || `输入 ${item.label}...`}
                            className="w-full rounded-lg border border-black/10 bg-white/60 px-3 py-1.5 text-[12px] text-foreground placeholder:text-foreground/30 focus:outline-none focus:ring-1 focus:ring-primary/30 font-mono"
                          />
                          {isMasked && (
                            <span className="absolute right-8 top-1/2 -translate-y-1/2 text-[10px] text-foreground/30">
                              输入新值覆盖
                            </span>
                          )}
                        </div>
                        {item.secret && (
                          <button
                            onClick={() => toggleSecret(item.key)}
                            className="shrink-0 rounded-lg border border-black/10 bg-white/60 p-1.5 text-foreground/40 hover:text-foreground/70 transition-colors"
                          >
                            {visibleSecrets.has(item.key) ? (
                              <EyeOff className="size-3.5" strokeWidth={1.5} />
                            ) : (
                              <Eye className="size-3.5" strokeWidth={1.5} />
                            )}
                          </button>
                        )}
                      </div>
                      {item.link && (
                        <a
                          href={item.link}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1 text-[11px] text-primary hover:underline"
                        >
                          {item.linkLabel || "获取"}
                          <ExternalLink className="size-2.5" strokeWidth={1.5} />
                        </a>
                      )}
                    </div>
                  </LiquidGlassCard>
                );
              })}
            </div>
          ))}

          {/* Save button */}
          <div className="flex items-center gap-3">
            <button
              onClick={handleSave}
              disabled={saving || !dirty}
              className="flex items-center gap-1.5 rounded-lg bg-primary px-4 py-2 text-[13px] font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {saving ? (
                <Loader2 className="size-3.5 animate-spin" strokeWidth={1.5} />
              ) : (
                <Save className="size-3.5" strokeWidth={1.5} />
              )}
              保存配置
            </button>
            {saveMsg && (
              <span className={`text-[12px] ${saveMsg.includes("失败") ? "text-red-500" : "text-positive"}`}>
                {saveMsg}
              </span>
            )}
          </div>
        </>
      ) : null}

      {/* Health Check Section */}
      <div className="space-y-3 pt-2">
        <div className="flex items-center justify-between">
          <h3 className="text-[13px] font-medium text-foreground/60">系统自检</h3>
          <button
            onClick={fetchHealth}
            disabled={healthLoading}
            className="flex items-center gap-1 rounded-lg border border-black/10 bg-white/60 px-2.5 py-1 text-[12px] font-[450] text-foreground/70 transition-colors hover:bg-white/80 disabled:opacity-50"
          >
            <RefreshCw className={`size-3 ${healthLoading ? "animate-spin" : ""}`} strokeWidth={1.5} />
            重新检测
          </button>
        </div>

        {healthError && (
          <LiquidGlassCard className="p-4">
            <div className="flex items-center gap-2 text-destructive">
              <AlertCircle className="size-4" strokeWidth={1.5} />
              <div>
                <p className="text-[14px] font-medium">无法连接后端服务</p>
                <p className="text-[12px] text-destructive/70 mt-0.5">
                  请确认后端服务已启动并运行在正确的端口。错误：{healthError}
                </p>
              </div>
            </div>
          </LiquidGlassCard>
        )}

        {healthLoading && !health && (
          <div className="flex items-center justify-center py-6">
            <Loader2 className="size-5 animate-spin text-[#aaa]" />
          </div>
        )}

        {health && (
          <>
            <LiquidGlassCard className="p-3.5">
              <div className="flex items-center gap-2">
                {health.ok ? (
                  <CheckCircle2 className="size-4 text-positive" strokeWidth={1.5} />
                ) : (
                  <AlertCircle className="size-4 text-amber-500" strokeWidth={1.5} />
                )}
                <span className="text-[13px] font-medium text-foreground">
                  {health.ok ? "所有服务正常" : "部分服务需要配置"}
                </span>
              </div>
            </LiquidGlassCard>

            <div className="space-y-1.5">
              {checks.map(([key, check]) => (
                <LiquidGlassCard key={key} className="px-3.5 py-2.5">
                  <div className="flex items-center gap-2.5">
                    {check.ok ? (
                      <CheckCircle2 className="size-3.5 text-positive shrink-0" strokeWidth={1.5} />
                    ) : (
                      <AlertCircle className="size-3.5 text-amber-500 shrink-0" strokeWidth={1.5} />
                    )}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-[12px] font-medium text-foreground">{check.label}</span>
                        <span
                          className={`text-[10px] px-1.5 py-0.5 rounded ${
                            check.ok ? "bg-positive/10 text-positive" : "bg-amber-500/10 text-amber-600"
                          }`}
                        >
                          {check.ok ? "正常" : "待配置"}
                        </span>
                      </div>
                      {check.hint && <p className="text-[10px] text-[#999] mt-0.5 truncate">{check.hint}</p>}
                    </div>
                  </div>
                </LiquidGlassCard>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
