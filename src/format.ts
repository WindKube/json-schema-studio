import { parse, stringify } from "yaml";

export type Format = "json" | "yaml";

export function parseText(text: string, format: Format): unknown {
  return format === "json" ? JSON.parse(text) : parse(text);
}

export function convert(text: string, from: Format, to: Format): string {
  if (from === to || !text.trim()) return text;
  const data = parseText(text, from);
  return to === "json" ? `${JSON.stringify(data, null, 2)}\n` : stringify(data);
}

export function formatFromFileName(name: string): Format {
  return /\.ya?ml$/i.test(name) ? "yaml" : "json";
}
