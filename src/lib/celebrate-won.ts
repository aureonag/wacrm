// ============================================================
// Confetti burst shown when a deal is marked as won — the
// "closed-won celebration" pattern from CRMs like Pipedrive/RD
// Station. Skipped entirely under prefers-reduced-motion.
// ============================================================

import confetti from "canvas-confetti";

const COLORS = ["#a78bfa", "#22c55e", "#facc15", "#38bdf8", "#f472b6"];

export function fireWonConfetti(): void {
  if (typeof window === "undefined") return;
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

  confetti({
    particleCount: 130,
    spread: 100,
    startVelocity: 45,
    origin: { y: 0.6 },
    colors: COLORS,
    zIndex: 9999,
  });

  const end = Date.now() + 2200;
  (function sideCannons() {
    confetti({ particleCount: 3, angle: 60, spread: 60, origin: { x: 0, y: 0.65 }, colors: COLORS, zIndex: 9999 });
    confetti({ particleCount: 3, angle: 120, spread: 60, origin: { x: 1, y: 0.65 }, colors: COLORS, zIndex: 9999 });
    if (Date.now() < end) requestAnimationFrame(sideCannons);
  })();
}
