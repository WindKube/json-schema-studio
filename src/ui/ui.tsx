import type { ReactNode } from "react";
import { Link } from "wouter";

export function Logo({ size = 28 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 28 28" fill="none" aria-hidden="true">
      <rect width="28" height="28" rx="7" className="fill-accent" />
      <path
        d="M11 8c-2 0-2.5 1-2.5 2.5v2c0 1-.6 1.5-1.5 1.5 .9 0 1.5.5 1.5 1.5v2C8.5 19 9 20 11 20M17 8c2 0 2.5 1 2.5 2.5v2c0 1 .6 1.5 1.5 1.5-.9 0-1.5.5-1.5 1.5v2c0 1.5-.5 2.5-2.5 2.5"
        stroke="#fff"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
    </svg>
  );
}

export function BackHome() {
  return (
    <Link href="/" aria-label="Back to my schemas" className="inline-flex">
      <Logo size={36} />
    </Link>
  );
}

export function Segmented<T extends string>({
  value,
  options,
  onChange,
  label,
  tone = "dark",
}: {
  value: T;
  options: [T, string][];
  onChange: (v: T) => void;
  label: string;
  tone?: "dark" | "pill";
}) {
  if (tone === "pill") {
    return (
      <fieldset
        aria-label={label}
        className="m-0 flex min-w-0 rounded-[9px] border-0 bg-track p-[3px]"
      >
        {options.map(([v, text]) => (
          <button
            key={v}
            type="button"
            aria-pressed={v === value}
            onClick={() => onChange(v)}
            className={`min-h-[34px] rounded-[7px] px-3 text-[13px] ${v === value ? "bg-surface font-semibold text-ink shadow-[0_1px_2px_rgba(15,18,24,0.08)]" : "text-ink-2"}`}
          >
            {text}
          </button>
        ))}
      </fieldset>
    );
  }
  return (
    <fieldset
      aria-label={label}
      className="m-0 flex min-w-0 overflow-hidden rounded-lg border border-line-strong p-0"
    >
      {options.map(([v, text], i) => (
        <button
          key={v}
          type="button"
          aria-pressed={v === value}
          onClick={() => onChange(v)}
          className={`min-h-[34px] px-3 text-[13px] ${i ? "border-l border-line" : ""} ${v === value ? "bg-ink font-semibold text-white" : "bg-surface text-ink-2"}`}
        >
          {text}
        </button>
      ))}
    </fieldset>
  );
}

const TONES = {
  ok: "bg-ok-bg text-ok",
  warn: "bg-warn-bg text-warn",
  err: "bg-err-bg text-err",
  info: "bg-accent-soft text-[#1e3a8a]",
  neutral: "bg-chip text-ink-2",
};

export type Tone = keyof typeof TONES;

export function Chip({
  tone,
  children,
  round,
}: {
  tone: Tone;
  children: ReactNode;
  round?: boolean;
}) {
  return (
    <span
      className={`inline-flex items-center px-2 py-0.5 text-[11px] font-bold ${round ? "rounded-full" : "rounded"} ${TONES[tone]}`}
    >
      {children}
    </span>
  );
}

const AVATAR_COLORS = [
  ["#DCE4FB", "#1E3A8A"],
  ["#FCE3D3", "#8A3A0A"],
  ["#D9F0E3", "#11603A"],
  ["#E3DDFB", "#4C2DB0"],
];

export function Avatar({
  login,
  url,
  size = 32,
}: {
  login: string;
  url?: string | null;
  size?: number;
}) {
  const [bg, fg] =
    AVATAR_COLORS[[...login].reduce((a, ch) => a + ch.charCodeAt(0), 0) % AVATAR_COLORS.length];
  if (url) {
    return <img src={url} alt="" width={size} height={size} className="shrink-0 rounded-full" />;
  }
  return (
    <span
      aria-hidden="true"
      style={{ width: size, height: size, background: bg, color: fg }}
      className="inline-flex shrink-0 items-center justify-center rounded-full text-xs font-bold"
    >
      {login.slice(0, 2).toUpperCase()}
    </span>
  );
}

export function Dialog({
  title,
  onClose,
  children,
  footer,
  width = "max-w-[860px]",
  subtitle,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  width?: string;
  subtitle?: string;
}) {
  return (
    <div className="fixed inset-0 z-40 flex items-start justify-center overflow-auto bg-[rgba(15,18,24,0.55)] px-5 py-16">
      <section
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onKeyDown={(e) => e.key === "Escape" && onClose()}
        className={`flex w-full ${width} flex-col overflow-hidden rounded-2xl bg-surface shadow-[0_24px_64px_rgba(15,18,24,0.28)]`}
      >
        <div className="flex items-center justify-between gap-3 border-b border-line px-6 py-5">
          <div className="flex flex-col gap-0.5">
            <h2 className="m-0 text-xl font-semibold tracking-tight">{title}</h2>
            {subtitle && <span className="text-muted">{subtitle}</span>}
          </div>
          <button
            type="button"
            aria-label="Close"
            onClick={onClose}
            className="inline-flex size-11 items-center justify-center rounded-[10px] text-ink-2 hover:bg-chip"
          >
            <svg
              width="20"
              height="20"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              aria-hidden="true"
            >
              <path d="M6 6l12 12M18 6 6 18" />
            </svg>
          </button>
        </div>
        <div className="flex flex-col gap-4 px-6 py-5">{children}</div>
        {footer && (
          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line bg-page px-6 py-4">
            {footer}
          </div>
        )}
      </section>
    </div>
  );
}

export function ErrorText({ error }: { error: unknown }) {
  if (!error) return null;
  return (
    <p role="alert" className="m-0 text-sm text-err">
      {(error as Error).message ?? String(error)}
    </p>
  );
}

export const srOnly = "absolute size-px overflow-hidden [clip:rect(0_0_0_0)]";
