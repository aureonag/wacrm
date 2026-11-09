// The "1/2" ring and heading on the left of the Novo cliente steps (same idea
// as Reportei's stepper). Pure presentation.

export function WizardProgress({ current, total, title, hint, side = false }: { current: number; total: number; title: string; hint: string; /** Text beside the ring, centred on it, instead of under it. */ side?: boolean }) {
  const r = 18;
  const circumference = 2 * Math.PI * r;
  return (
    <div className={side ? "flex items-center gap-4" : "flex items-start gap-4 lg:flex-col lg:gap-3"}>
      <div className="relative h-14 w-14 shrink-0">
        <svg viewBox="0 0 44 44" className="h-14 w-14 -rotate-90" aria-hidden="true">
          <circle cx="22" cy="22" r={r} fill="none" strokeWidth="4" className="stroke-muted" />
          <circle
            cx="22"
            cy="22"
            r={r}
            fill="none"
            strokeWidth="4"
            strokeLinecap="round"
            strokeDasharray={circumference}
            strokeDashoffset={circumference * (1 - current / total)}
            className="stroke-primary"
          />
        </svg>
        <span className="absolute inset-0 flex items-center justify-center text-xs font-semibold text-foreground">
          {current}/{total}
        </span>
      </div>
      <div>
        <h2 className="text-lg font-semibold text-foreground">{title}</h2>
        <p className="mt-1 text-sm text-muted-foreground">{hint}</p>
      </div>
    </div>
  );
}
