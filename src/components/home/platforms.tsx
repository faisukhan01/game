"use client";

/**
 * VOIDSTRIKE — PLATFORMS section: where the arena runs.
 */

import { motion } from "framer-motion";

const PLATFORMS = [
  { name: "BROWSER", stack: "NEXT.JS 16 + CANVAS", status: "LIVE NOW", live: true, note: "You are here. Deploy above." },
  { name: "iOS / ANDROID", stack: "FLUTTER + FLAME", status: "FLIGHT PILOT", live: false, note: "Twin-stick touch client in private flight." },
  { name: "PC", stack: "UNITY (C#) CLIENT", status: "IN CERT", live: false, note: "Shares the Voidstrike.Core simulation package." },
  { name: "CONSOLE", stack: "UNREAL (C++) MODULE", status: "IN CERT", live: false, note: "Fixed-step sim subsystem, replication-ready." },
  { name: "COMPANION", stack: "KOTLIN + COMPOSE", status: "FLIGHT PILOT", live: false, note: "Ladder, stats and push alerts on the go." },
];

export function Platforms() {
  return (
    <section id="platforms" className="scroll-mt-20 border-t border-line px-4 py-16 md:px-6 md:py-24">
      <div className="mx-auto max-w-7xl">
        <div className="flex flex-wrap items-baseline justify-between gap-4">
          <h2 className="font-display text-2xl font-bold tracking-tight text-ink md:text-4xl">
            PLATFORMS
          </h2>
          <p className="font-mono text-[10px] tracking-[0.3em] text-mute">
            {"// ONE PROTOCOL · FIVE FRONTS"}
          </p>
        </div>

        <div className="mt-8 grid gap-px border border-line bg-line sm:grid-cols-2 lg:grid-cols-3">
          {PLATFORMS.map((p, i) => (
            <motion.div
              key={p.name}
              initial={{ opacity: 0, y: 12 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, margin: "-60px" }}
              transition={{ duration: 0.2, delay: i * 0.04, ease: "easeOut" }}
              className="flex min-h-[168px] flex-col justify-between bg-void p-6"
            >
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h3 className="font-display text-lg font-semibold text-ink">{p.name}</h3>
                  <p className="mt-1 font-mono text-[10px] tracking-[0.22em] text-mute">{p.stack}</p>
                </div>
                <span
                  className={`border px-2 py-0.5 font-mono text-[9px] tracking-[0.2em] ${
                    p.live
                      ? "border-volt bg-volt/10 text-volt"
                      : "border-amber/50 text-amber"
                  }`}
                >
                  {p.status}
                </span>
              </div>
              <p className="mt-4 text-sm leading-relaxed text-mute">{p.note}</p>
            </motion.div>
          ))}

          {/* CTA card */}
          <motion.a
            href="https://github.com/faisukhan01/game"
            target="_blank"
            rel="noreferrer noopener"
            initial={{ opacity: 0, y: 12 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, margin: "-60px" }}
            transition={{ duration: 0.2, delay: 0.2, ease: "easeOut" }}
            className="flex min-h-[168px] flex-col justify-between bg-volt p-6 text-void transition-[filter] hover:brightness-110"
          >
            <div>
              <h3 className="font-display text-lg font-semibold">READ THE SOURCE</h3>
              <p className="mt-1 font-mono text-[10px] tracking-[0.22em] opacity-80">
                GITHUB · FULL MONOREPO
              </p>
            </div>
            <p className="mt-4 text-sm font-medium leading-relaxed">
              Engine core, netcode, training pipeline, infra — everything, in the open.
            </p>
          </motion.a>
        </div>
      </div>
    </section>
  );
}
