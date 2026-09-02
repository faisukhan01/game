"use client";

/**
 * VOIDSTRIKE — Arena Protocol. Single-route application:
 * HOME (marketing + entry) → PLAYING (canvas arena) → RESULTS (rank + ladder).
 */

import { useEffect } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Nav } from "@/components/home/nav";
import { Backdrop } from "@/components/home/backdrop";
import { Hero } from "@/components/home/hero";
import { Intel } from "@/components/home/intel";
import { Ranked } from "@/components/home/ranked";
import { Platforms } from "@/components/home/platforms";
import { Footer } from "@/components/home/footer";
import { Arena } from "@/components/game/arena";
import { Results } from "@/components/game/results";
import { useGameStore } from "@/store/game-store";

export default function Home() {
  const view = useGameStore((s) => s.view);
  const matchKey = useGameStore((s) => s.matchKey);
  const hydrate = useGameStore((s) => s.hydrate);

  useEffect(() => {
    hydrate();
  }, [hydrate]);

  /* lock body scroll while the arena owns the screen */
  useEffect(() => {
    document.body.style.overflow = view === "HOME" ? "" : "hidden";
    return () => {
      document.body.style.overflow = "";
    };
  }, [view]);

  return (
    <div className="min-h-screen">
      <AnimatePresence mode="wait">
        {view === "HOME" && (
          <motion.div
            key="home"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0, transition: { duration: 0.16 } }}
            className="flex min-h-screen flex-col"
          >
            <Nav />
            <Backdrop />
            <main className="relative z-10 flex flex-col">
              <Hero />
              <Intel />
              <Ranked />
              <Platforms />
            </main>
            <Footer />
          </motion.div>
        )}

        {view === "PLAYING" && <Arena key={matchKey} />}

        {view === "RESULTS" && <Results key={`results-${matchKey}`} />}
      </AnimatePresence>
    </div>
  );
}
