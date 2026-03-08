import type { Metadata } from "next";
import { Toaster } from "sonner";
import { TopicProvider } from "@/lib/topic-context";
import { AppShell } from "@/components/layout/app-shell";
import "./globals.css";

export const metadata: Metadata = {
  title: "Knovie · 知频",
  description: "视频知识库 — 从 B站/YouTube 采集、转录、AI 问答",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="zh-CN">
      <body className="font-sans">
        <TopicProvider>
          <AppShell>{children}</AppShell>
        </TopicProvider>
        <Toaster richColors position="top-right" />
      </body>
    </html>
  );
}
