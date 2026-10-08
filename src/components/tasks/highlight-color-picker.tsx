"use client";

import { useRef, useState } from "react";
import { Check, Eraser, Pipette } from "lucide-react";
import { useTranslations } from "next-intl";
import {
  DEFAULT_HIGHLIGHT,
  HIGHLIGHT_PRESETS,
  hexToHsv,
  hsvToHex,
  normalizeHex,
  type Hsv,
} from "@/lib/tasks/color";

// Color picker for the briefing highlighter: a saturation/brightness square,
// a hue strip, a hex field, an eyedropper (where the browser has one) and the
// basic colors ready to click. Everything here only PREVIEWS the color; the
// text is changed when the person confirms with the "Aplicar" button.

interface HighlightColorPickerProps {
  /** Color of the highlight under the cursor / selection, if any. */
  color: string | null;
  onPick: (hex: string) => void;
  onClear: () => void;
}

interface EyeDropperCtor {
  new (): { open: () => Promise<{ sRGBHex: string }> };
}

const clamp01 = (n: number) => Math.min(1, Math.max(0, n));

/** A box that reports the pointer position (0-1 on both axes) while it is dragged. */
function DragArea({
  className,
  style,
  label,
  onChange,
  children,
}: {
  className?: string;
  style?: React.CSSProperties;
  label: string;
  onChange: (x: number, y: number) => void;
  children: React.ReactNode;
}) {
  const dragging = useRef(false);

  function read(e: React.PointerEvent<HTMLDivElement>) {
    const rect = e.currentTarget.getBoundingClientRect();
    onChange(clamp01((e.clientX - rect.left) / rect.width), clamp01((e.clientY - rect.top) / rect.height));
  }

  return (
    <div
      role="presentation"
      aria-label={label}
      title={label}
      className={`touch-none select-none ${className ?? ""}`}
      style={style}
      onPointerDown={(e) => {
        dragging.current = true;
        e.currentTarget.setPointerCapture(e.pointerId);
        read(e);
      }}
      onPointerMove={(e) => {
        if (dragging.current) read(e);
      }}
      onPointerUp={() => {
        dragging.current = false;
      }}
      onPointerCancel={() => {
        dragging.current = false;
      }}
    >
      {children}
    </div>
  );
}

export function HighlightColorPicker({ color, onPick, onClear }: HighlightColorPickerProps) {
  const t = useTranslations("Operational.briefing");
  const initial = normalizeHex(color) ?? DEFAULT_HIGHLIGHT;
  const [hsv, setHsv] = useState<Hsv>(() => hexToHsv(initial));
  const [hexText, setHexText] = useState(initial);
  // The drag handlers need the latest value without waiting for a re-render.
  const hsvRef = useRef(hsv);
  const eyedropper =
    typeof window !== "undefined" ? (window as unknown as { EyeDropper?: EyeDropperCtor }).EyeDropper : undefined;

  const shown = hsvToHex(hsv);

  function preview(next: Hsv) {
    hsvRef.current = next;
    setHsv(next);
    setHexText(hsvToHex(next));
  }

  function apply() {
    onPick(hsvToHex(hsvRef.current));
  }

  /** Validates a typed/clicked hex and shows it in the picker (does not touch the text yet). */
  function previewHex(raw: string) {
    const hex = normalizeHex(raw);
    if (!hex) {
      setHexText(hsvToHex(hsvRef.current));
      return;
    }
    const next = hexToHsv(hex);
    // Keep the hue the person was on when the color has none (greys, black, white).
    if (next.s === 0) next.h = hsvRef.current.h;
    preview(next);
  }

  async function pickFromScreen() {
    if (!eyedropper) return;
    try {
      const { sRGBHex } = await new eyedropper().open();
      previewHex(sRGBHex);
    } catch {
      // Cancelled with Esc: nothing to do.
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <DragArea
        label={t("pickerArea")}
        className="relative h-36 w-full cursor-crosshair overflow-hidden rounded-md"
        style={{ backgroundColor: hsvToHex({ h: hsv.h, s: 1, v: 1 }) }}
        onChange={(x, y) => preview({ ...hsvRef.current, s: x, v: 1 - y })}
      >
        <div className="absolute inset-0" style={{ background: "linear-gradient(to right, #fff, rgba(255,255,255,0))" }} />
        <div className="absolute inset-0" style={{ background: "linear-gradient(to top, #000, rgba(0,0,0,0))" }} />
        <span
          className="pointer-events-none absolute h-4 w-4 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white shadow-[0_0_0_1px_rgba(0,0,0,0.5)]"
          style={{ left: `${hsv.s * 100}%`, top: `${(1 - hsv.v) * 100}%`, backgroundColor: shown }}
        />
      </DragArea>

      <div className="flex items-center gap-2">
        {eyedropper && (
          <button
            type="button"
            onClick={pickFromScreen}
            aria-label={t("pickerEyedropper")}
            title={t("pickerEyedropper")}
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-border text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            <Pipette className="h-4 w-4" />
          </button>
        )}
        <DragArea
          label={t("pickerHue")}
          className="relative h-3 min-w-0 flex-1 cursor-pointer rounded-full"
          style={{ background: "linear-gradient(to right, #f00, #ff0, #0f0, #0ff, #00f, #f0f, #f00)" }}
          onChange={(x) => preview({ ...hsvRef.current, h: x * 360 })}
        >
          <span
            className="pointer-events-none absolute top-1/2 h-4 w-4 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white shadow-[0_0_0_1px_rgba(0,0,0,0.5)]"
            style={{ left: `${(hsv.h / 360) * 100}%`, backgroundColor: hsvToHex({ h: hsv.h, s: 1, v: 1 }) }}
          />
        </DragArea>
      </div>

      <div className="flex items-center gap-2">
        <span
          className="h-8 w-8 shrink-0 rounded-md border border-border"
          style={{ backgroundColor: shown }}
          aria-hidden="true"
        />
        <label className="flex min-w-0 flex-1 items-center gap-2 rounded-md border border-border bg-muted px-2 text-xs text-muted-foreground focus-within:border-primary">
          Hex
          <input
            value={hexText}
            maxLength={7}
            spellCheck={false}
            aria-label="Hex"
            onChange={(e) => setHexText(e.target.value)}
            onBlur={(e) => previewHex(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                previewHex(e.currentTarget.value);
                apply();
              }
            }}
            className="h-8 min-w-0 flex-1 bg-transparent font-mono text-xs uppercase text-foreground outline-none"
          />
        </label>
      </div>

      <div className="flex flex-col gap-1.5 border-t border-border pt-3">
        {HIGHLIGHT_PRESETS.map((row, i) => (
          <div key={i} className="flex flex-wrap gap-1.5">
            {row.map((hex) => (
              <button
                key={hex}
                type="button"
                onClick={() => previewHex(hex)}
                aria-label={hex}
                title={hex}
                className={`h-5 w-5 rounded-md border transition-transform hover:scale-110 ${
                  shown === hex ? "border-primary ring-2 ring-primary/60" : "border-border"
                }`}
                style={{ backgroundColor: hex }}
              />
            ))}
          </div>
        ))}
      </div>

      <div className="flex flex-col gap-2">
        <button
          type="button"
          onClick={onClear}
          className="flex items-center justify-center gap-2 rounded-md border border-border px-2 py-1.5 text-xs text-muted-foreground hover:bg-muted hover:text-foreground"
        >
          <Eraser className="h-3.5 w-3.5" />
          {t("highlightRemove")}
        </button>
        <button
          type="button"
          onClick={apply}
          className="flex items-center justify-center gap-2 rounded-md bg-primary px-2 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90"
        >
          <Check className="h-3.5 w-3.5" />
          {t("highlightApply")}
        </button>
      </div>
    </div>
  );
}
