"use client";

import Link from "next/link";
import { Menu } from "lucide-react";
import { useTopic } from "@/lib/topic-context";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

const PAGE_TITLES: Record<string, string> = {
  "/": "仪表盘",
  "/collect": "采集",
  "/explore": "浏览",
  "/chat": "问答",
  "/tasks": "任务中心",
  "/settings": "设置",
};

export function TopBar({
  pathname,
  onMenuClick,
}: {
  pathname: string;
  onMenuClick?: () => void;
}) {
  const { topics, selectedTopic, selectTopic } = useTopic();

  const title = Object.entries(PAGE_TITLES).find(
    ([path]) => (path === "/" ? pathname === "/" : pathname.startsWith(path))
  )?.[1] ?? "知频";

  const hideTopicSelector = pathname === "/" || pathname === "/collect" || pathname === "/settings" || pathname === "/tasks";

  return (
    <header className="flex h-14 items-center justify-between border-b border-black/[.06] px-4 md:px-6">
      <div className="flex items-center gap-2">
        <button
          onClick={onMenuClick}
          className="flex md:hidden size-8 items-center justify-center rounded-lg text-[#777] transition-colors hover:bg-black/5"
          aria-label="打开导航菜单"
        >
          <Menu className="size-5" strokeWidth={1.5} />
        </button>
        <h1 className="text-[15px] font-medium tracking-tight text-foreground">{title}</h1>
      </div>
      {!hideTopicSelector && (
        <div className="flex items-center gap-3">
          <span className="text-[12px] text-[#999] hidden sm:inline">当前知识库</span>
          {topics.length > 0 ? (
            <Select
              value={selectedTopic?.id ?? ""}
              onValueChange={(val) => {
                const t = topics.find((t) => t.id === val);
                if (t) selectTopic(t);
              }}
            >
              <SelectTrigger className="w-36 sm:w-48 h-8 rounded-lg border-black/10 bg-white text-[13px] font-[450]">
                <SelectValue placeholder="选择知识库..." />
              </SelectTrigger>
              <SelectContent>
                {topics.map((t) => (
                  <SelectItem key={t.id} value={t.id}>
                    {t.name} ({t.videoCount})
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          ) : (
            <Link
              href="/collect"
              className="text-[12px] text-primary hover:underline font-medium"
            >
              去采集页创建 →
            </Link>
          )}
        </div>
      )}
    </header>
  );
}
