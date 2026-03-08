"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  LayoutDashboard,
  Download,
  Library,
  MessageSquare,
  ListChecks,
  Settings,
  PanelLeftClose,
  PanelLeft,
} from "lucide-react";
import { useState, useEffect } from "react";
import { cn } from "@/lib/utils";
import { listConversations, type SavedConversation } from "@/lib/conversations";

const NAV_ITEMS = [
  { href: "/", label: "仪表盘", icon: LayoutDashboard },
  { href: "/collect", label: "采集", icon: Download },
  { href: "/explore", label: "浏览", icon: Library },
  { href: "/chat", label: "问答", icon: MessageSquare },
  { href: "/tasks", label: "任务中心", icon: ListChecks },
  { href: "/settings", label: "设置", icon: Settings },
];

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

export function Sidebar() {
  const pathname = usePathname();
  const [collapsed, setCollapsed] = useState(false);
  const [recentChats, setRecentChats] = useState<SavedConversation[]>([]);

  useEffect(() => {
    const load = () => {
      try {
        setRecentChats(listConversations().slice(0, 5));
      } catch { /* ignore */ }
    };
    load();
    const interval = setInterval(load, 5000);
    return () => clearInterval(interval);
  }, []);

  return (
    <aside
      className={cn(
        "flex h-screen flex-col border-r border-black/[.06] bg-[#fcfcf9] transition-all duration-200 select-none",
        collapsed ? "w-16" : "w-[220px]"
      )}
    >
      {/* Logo + Collapse */}
      <div className="flex h-14 items-center justify-between px-3">
        {!collapsed && (
          <Link href="/" className="flex items-center">
            <span className="text-[15px] font-[480] tracking-tight text-foreground">
              知频
            </span>
          </Link>
        )}
        <button
          onClick={() => setCollapsed(!collapsed)}
          className={cn(
            "flex size-8 items-center justify-center rounded-lg text-[#777] transition-colors hover:bg-black/5",
            collapsed && "mx-auto"
          )}
        >
          {collapsed ? (
            <PanelLeft className="size-[18px]" strokeWidth={1.5} />
          ) : (
            <PanelLeftClose className="size-[18px]" strokeWidth={1.5} />
          )}
        </button>
      </div>

      <div className="mx-1 h-px bg-black/[.07]" />

      {/* Navigation */}
      <nav className="flex-1 flex flex-col gap-px p-2.5 overflow-hidden">
        {NAV_ITEMS.map((item) => {
          const isActive =
            item.href === "/" ? pathname === "/" : pathname.startsWith(item.href);
          return (
            <Link key={item.href} href={item.href}>
              <div
                className={cn(
                  "flex items-center gap-2.5 rounded-lg px-3 py-2 text-[14px] transition-colors",
                  isActive
                    ? "bg-black/[.06] font-medium text-foreground"
                    : "font-[450] text-foreground/70 hover:bg-black/5 hover:text-foreground"
                )}
              >
                <item.icon
                  className={cn(
                    "size-[18px] shrink-0",
                    isActive ? "text-foreground" : "text-[#555]"
                  )}
                  strokeWidth={1.5}
                />
                {!collapsed && <span>{item.label}</span>}
              </div>
            </Link>
          );
        })}

        {!collapsed && recentChats.length > 0 && (
          <>
            <div className="mx-1 my-2 h-px bg-black/[.07]" />
            <div className="px-3 pt-1 pb-1 text-[11px] font-medium tracking-wide text-[#999] uppercase">
              最近对话
            </div>
            <div className="flex flex-col gap-px overflow-y-auto">
              {recentChats.map((chat) => {
                const isActive = pathname === "/chat" && typeof window !== "undefined" && new URLSearchParams(window.location.search).get("id") === chat.id;
                return (
                  <Link key={chat.id} href={`/chat?id=${chat.id}`}>
                    <div className={cn(
                      "rounded-md px-3 py-1.5 transition-colors hover:bg-black/5 group",
                      isActive && "bg-black/[.04]"
                    )}>
                      <p className="text-[12px] text-foreground/80 truncate leading-tight">
                        {chat.title}
                      </p>
                      <p className="text-[10px] text-[#bbb] mt-0.5">
                        {getRelativeTime(chat.updatedAt)}
                      </p>
                    </div>
                  </Link>
                );
              })}
            </div>
          </>
        )}
      </nav>

      {/* Bottom */}
      <div className="px-3 pb-3">
        {!collapsed && (
          <p className="text-[11px] text-[#bbb] text-center">
            Knovie v0.2
          </p>
        )}
      </div>
    </aside>
  );
}
