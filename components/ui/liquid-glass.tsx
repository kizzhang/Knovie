"use client";

import type { ReactNode } from "react";

export function GlassDistortionSVG() {
  return (
    <svg style={{ display: "none" }} aria-hidden="true">
      <filter
        id="glass-distortion"
        x="0%"
        y="0%"
        width="100%"
        height="100%"
        filterUnits="objectBoundingBox"
      >
        <feTurbulence
          type="fractalNoise"
          baseFrequency="0.01 0.01"
          numOctaves="1"
          seed="5"
          result="turbulence"
        />
        <feComponentTransfer in="turbulence" result="mapped">
          <feFuncR type="gamma" amplitude="1" exponent="10" offset="0.5" />
          <feFuncG type="gamma" amplitude="0" exponent="1" offset="0" />
          <feFuncB type="gamma" amplitude="0" exponent="1" offset="0.5" />
        </feComponentTransfer>
        <feGaussianBlur in="turbulence" stdDeviation="3" result="softMap" />
        <feSpecularLighting
          in="softMap"
          surfaceScale="5"
          specularConstant="1"
          specularExponent="100"
          lightingColor="white"
          result="specLight"
        >
          <fePointLight x="-200" y="-200" z="300" />
        </feSpecularLighting>
        <feComposite
          in="specLight"
          operator="arithmetic"
          k1="0"
          k2="1"
          k3="1"
          k4="0"
          result="litImage"
        />
        <feDisplacementMap
          in="SourceGraphic"
          in2="softMap"
          scale="150"
          xChannelSelector="R"
          yChannelSelector="G"
        />
      </filter>
    </svg>
  );
}

export function LiquidGlassCard({
  children,
  className = "",
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={`liquid-glass rounded-2xl ${className}`}>
      <div
        className="absolute inset-0 z-0 rounded-2xl"
        style={{
          background: `
            radial-gradient(ellipse 120% 80% at 20% 30%, rgba(180, 200, 240, 0.15), transparent 60%),
            radial-gradient(ellipse 100% 70% at 80% 60%, rgba(200, 180, 230, 0.12), transparent 55%),
            radial-gradient(ellipse 80% 60% at 50% 90%, rgba(180, 220, 240, 0.1), transparent 50%)
          `,
        }}
      />
      <div className="liquid-glass-effect rounded-2xl" />
      <div className="liquid-glass-tint rounded-2xl" />
      <div className="liquid-glass-shine rounded-2xl" />
      <div className="liquid-glass-content">{children}</div>
    </div>
  );
}
