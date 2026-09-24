"use client";

import { useEffect, useState } from "react";

const LINKS = [
  { label: "ARENA", href: "#arena" },
  { label: "INTEL", href: "#intel" },
  { label: "RANKED", href: "#ranked" },
  { label: "PLATFORMS", href: "#platforms" },
];

export function BrandMark({ size = 22 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 32 32"
      aria-hidden
      className="shrink-0"
    >
      <rect width="32" height="32" fill="#0E1013" />
      <path d="M5 5 L16 27 L27 5 L21 5 L16 16 L11 5 Z" fill="#C8F31D" />
      <rect x="21" y="21" width="6" height="6" fill="#FF3D5A" />
    </svg>
  );
}

export function Nav() {
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <header
      className={`fixed inset-x-0 top-0 z-40 h-14 border-b border-line transition-colors ${
        scrolled ? "bg-void/90 backdrop-blur-md" : "bg-void/60 backdrop-blur-sm"
      }`}
    >
      <div className="mx-auto flex h-full max-w-7xl items-center justify-between gap-4 px-4 md:px-6">
        <a
          href="#arena"
          className="flex items-center gap-2.5"
          aria-label="VOIDSTRIKE home"
        >
          <BrandMark />
          <span className="font-display text-lg font-bold tracking-[0.18em] text-ink">
            VOIDSTRIKE
          </span>
          <span className="hidden font-mono text-[9px] tracking-[0.3em] text-mute lg:inline">
            {"// ARENA PROTOCOL"}
          </span>
        </a>

        <nav aria-label="Primary" className="hidden items-center gap-7 md:flex">
          {LINKS.map((l) => (
            <a
              key={l.href}
              href={l.href}
              className="font-mono text-[11px] tracking-[0.24em] text-mute transition-colors hover:text-volt"
            >
              {l.label}
            </a>
          ))}
        </nav>

        <div className="flex items-center gap-2 border border-line bg-panel/60 px-3 py-1.5 clip-tag">
          <span className="inline-block size-1.5 bg-volt" aria-hidden />
          <span className="whitespace-nowrap font-mono text-[10px] tracking-[0.18em] text-ink">
            S1 // ARENA PROTOCOL
          </span>
        </div>
      </div>
    </header>
  );
}
