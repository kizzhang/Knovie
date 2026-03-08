import type { NextConfig } from "next";

const BACKEND_URL = process.env.BACKEND_URL || "http://localhost:8000";

const nextConfig: NextConfig = {
  output: "standalone",
  async rewrites() {
    return [
      {
        source: "/api/proxy-image",
        destination: `${BACKEND_URL}/api/proxy-image`,
      },
      {
        source: "/api/topics",
        destination: `${BACKEND_URL}/api/topics`,
      },
      {
        source: "/api/topics/:id",
        destination: `${BACKEND_URL}/api/topics/:id`,
      },
      {
        source: "/api/videos",
        destination: `${BACKEND_URL}/api/videos`,
      },
      {
        source: "/api/videos/:id",
        destination: `${BACKEND_URL}/api/videos/:id`,
      },
      {
        source: "/api/videos/:id/transcript",
        destination: `${BACKEND_URL}/api/videos/:id/transcript`,
      },
      {
        source: "/api/collect",
        destination: `${BACKEND_URL}/api/collect`,
      },
      {
        source: "/api/collect/:taskId/status",
        destination: `${BACKEND_URL}/api/collect/:taskId/status`,
      },
      {
        source: "/api/collect/:taskId/cancel",
        destination: `${BACKEND_URL}/api/collect/:taskId/cancel`,
      },
      {
        source: "/api/creators",
        destination: `${BACKEND_URL}/api/creators`,
      },
      {
        source: "/api/stats",
        destination: `${BACKEND_URL}/api/stats`,
      },
      {
        source: "/api/health",
        destination: `${BACKEND_URL}/api/health`,
      },
      {
        source: "/api/tasks",
        destination: `${BACKEND_URL}/api/tasks`,
      },
      {
        source: "/api/import-video",
        destination: `${BACKEND_URL}/api/import-video`,
      },
      {
        source: "/api/import-creator",
        destination: `${BACKEND_URL}/api/import-creator`,
      },
      {
        source: "/api/transcribe",
        destination: `${BACKEND_URL}/api/transcribe`,
      },
      {
        source: "/api/cache/:path*",
        destination: `${BACKEND_URL}/api/cache/:path*`,
      },
    ];
  },
};

export default nextConfig;
