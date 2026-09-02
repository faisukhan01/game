"use client";

/**
 * VOIDSTRIKE — INTEL section: what makes this game different. Hairline
 * cards, mono metadata, zero fluff copy.
 */

import { motion } from "framer-motion";

const FEATURES = [
  {
    tag: "NETCODE",
    title: "60Hz authoritative server",
    body: "The Go server owns every tick. Clients predict, the server decides — no desyncs, no trust. Snapshots at 20Hz, input last-wins, rollback-ready.",
    meta: "GO · WEBSOCKET · 8P VERSUS",
  },
  {
    tag: "MLOPS",
    title: "Bots that learn the meta",
    body: "The botlab pipeline trains combat policies against the live simulation, gates them through evaluation, and ships versioned manifests the server loads at boot.",
    meta: "PYTHON · RL · MODEL REGISTRY",
  },
  {
    tag: "CORE",
    title: "One deterministic simulation",
    body: "A single C99 core defines every rule. Go, TypeScript, C#, C++ and Dart ports are locked to it with golden-vector checksums — tick for tick, across languages.",
    meta: "C99 · FNV-1a CHECKSUMS · PROTOCOL v1",
  },
  {
    tag: "LIVE-OPS",
    title: "Seasons, ranked, telemetry",
    body: "Four-week ranked seasons with a Glicko-lite ladder. Match telemetry feeds difficulty directors and KPI reports. Fraudulent scorelines get rejected at the door.",
    meta: "JAVA · PRISMA · PROMETHEUS",
  },
];

export function Intel() {
  return (
    <section id="intel" className="scroll-mt-20 border-t border-line px-4 py-16 md:px-6 md:py-24">
      <div className="mx-auto max-w-7xl">
        <div className="flex items-baseline justify-between gap-4">
          <h2 className="font-display text-2xl font-bold tracking-tight text-ink md:text-4xl">
            INTEL
          </h2>
          <p className="font-mono text-[10px] tracking-[0.3em] text-mute">
            {"// WHY THIS ARENA HITS DIFFERENT"}
          </p>
        </div>

        <div className="mt-8 grid gap-px border border-line bg-line sm:grid-cols-2">
          {FEATURES.map((f, i) => (
            <motion.article
              key={f.tag}
              initial={{ opacity: 0, y: 12 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, margin: "-60px" }}
              transition={{ duration: 0.22, delay: i * 0.05, ease: "easeOut" }}
              className="group bg-void p-6 transition-colors hover:bg-panel md:p-8"
            >
              <div className="flex items-center justify-between">
                <span className="font-mono text-[10px] tracking-[0.3em] text-volt">
                  {f.tag}
                </span>
                <span className="h-px w-10 bg-line transition-all group-hover:w-16 group-hover:bg-volt" aria-hidden />
              </div>
              <h3 className="mt-4 font-display text-lg font-semibold text-ink md:text-xl">
                {f.title}
              </h3>
              <p className="mt-3 text-sm leading-relaxed text-mute">{f.body}</p>
              <p className="mt-5 font-mono text-[10px] tracking-[0.22em] text-mute/70">
                {f.meta}
              </p>
            </motion.article>
          ))}
        </div>
      </div>
    </section>
  );
}
