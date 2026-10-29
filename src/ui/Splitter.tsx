import { useEffect, useState } from "react";

const read = (key: string, fallback: number) => {
  try {
    const n = Number(localStorage.getItem(key));
    return n > 0 ? n : fallback;
  } catch {
    return fallback;
  }
};

// Width of a panel docked to the right edge, dragged by a handle on its left side.
export function usePanelWidth(key: string, initial: number, min: number, minRest: number) {
  const [width, setWidth] = useState(() => read(key, initial));
  const [, rerender] = useState(0);
  useEffect(() => {
    const onResize = () => rerender((n) => n + 1);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);
  const clamp = (w: number) => Math.round(Math.max(min, Math.min(w, window.innerWidth - minRest)));
  const set = (w: number) => {
    const next = clamp(w);
    setWidth(next);
    try {
      localStorage.setItem(key, String(next));
    } catch {}
  };
  return { width: clamp(width), set, min };
}

export function Splitter({
  label,
  width,
  set,
  min,
}: {
  label: string;
  width: number;
  set: (w: number) => void;
  min: number;
}) {
  const [dragging, setDragging] = useState(false);

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    setDragging(true);
  };
  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (dragging) set(window.innerWidth - e.clientX);
  };
  const onKeyDown = (e: React.KeyboardEvent) => {
    const step = e.shiftKey ? 64 : 16;
    if (e.key === "ArrowLeft") set(width + step);
    else if (e.key === "ArrowRight") set(width - step);
    else return;
    e.preventDefault();
  };

  return (
    // biome-ignore lint/a11y/useSemanticElements: <hr> can't be focused or dragged.
    <div
      role="separator"
      aria-label={label}
      aria-orientation="vertical"
      aria-valuenow={width}
      aria-valuemin={min}
      tabIndex={0}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={() => setDragging(false)}
      onPointerCancel={() => setDragging(false)}
      onKeyDown={onKeyDown}
      className={`group relative hidden w-1.5 shrink-0 cursor-col-resize touch-none bg-code-line outline-none hover:bg-accent focus-visible:bg-accent lg:block ${dragging ? "bg-accent" : ""}`}
    >
      <span className="absolute inset-y-0 -left-1.5 -right-1.5" />
    </div>
  );
}
