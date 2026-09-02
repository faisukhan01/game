"use client";

/**
 * VOIDSTRIKE — footer. Sticky to the viewport bottom via mt-auto in the
 * page flex column; pushed naturally when content overflows.
 */

import { RULES_HASH } from "@/lib/sim/hash";

export function Footer() {
  return (
    <footer className="mt-auto border-t border-line bg-void">
      <div className="mx-auto flex max-w-7xl flex-col gap-6 px-4 py-8 md:flex-row md:items-center md:justify-between md:px-6">
        <div className="flex items-center gap-3">
          <img src="/vs-mark.svg" alt="VOIDSTRIKE mark" className="size-7" />
          <div>
            <p className="font-display text-sm font-bold tracking-[0.18em] text-ink">
              VOIDSTRIKE
            </p>
            <p className="font-mono text-[9px] tracking-[0.26em] text-mute">
              ARENA PROTOCOL
            </p>
          </div>
        </div>

        <nav aria-label="Footer" className="flex flex-wrap items-center gap-x-6 gap-y-2 font-mono text-[10px] tracking-[0.24em] text-mute">
          <a href="#arena" className="hover:text-volt">ARENA</a>
          <a href="#intel" className="hover:text-volt">INTEL</a>
          <a href="#ranked" className="hover:text-volt">RANKED</a>
          <a href="#platforms" className="hover:text-volt">PLATFORMS</a>
          <a
            href="https://github.com/faisukhan01/game"
            target="_blank"
            rel="noreferrer noopener"
            className="hover:text-volt"
          >
            SOURCE
          </a>
        </nav>

        <div className="flex flex-col gap-1 md:items-end">
          <span className="border border-line px-2 py-0.5 font-mono text-[9px] tracking-[0.2em] text-mute">
            PROTOCOL v1 · {RULES_HASH.slice(0, 10)}
          </span>
          <p className="font-mono text-[9px] tracking-[0.22em] text-mute/70">
            © 2026 VOIDSTRIKE STUDIOS · DROP IN. LOCK ON. LEAVE NOTHING.
          </p>
        </div>
      </div>
    </footer>
  );
}
