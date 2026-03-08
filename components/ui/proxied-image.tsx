"use client";

import { useState } from "react";

export function proxyImageUrl(url: string | undefined | null): string | undefined {
  if (!url) return undefined;
  return `/api/proxy-image?url=${encodeURIComponent(url)}`;
}

export function ProxiedImage({
  src,
  alt,
  className,
  fallbackClassName,
  ...props
}: React.ImgHTMLAttributes<HTMLImageElement> & { fallbackClassName?: string }) {
  const [error, setError] = useState(false);
  const proxied = proxyImageUrl(src);

  if (!proxied || error) {
    return (
      <div className={fallbackClassName || className || "bg-[#f0eeea] flex items-center justify-center"}>
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="text-[#ccc]">
          <rect x="3" y="3" width="18" height="18" rx="2" />
          <circle cx="8.5" cy="8.5" r="1.5" />
          <path d="m21 15-5-5L5 21" />
        </svg>
      </div>
    );
  }

  return (
    <img
      {...props}
      src={proxied}
      alt={alt}
      className={className}
      onError={() => setError(true)}
      loading="lazy"
    />
  );
}
