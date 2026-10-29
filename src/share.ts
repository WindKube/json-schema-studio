import LZString from "lz-string";
import type { Format } from "./format";
import type { SchemaRef } from "./store";

export type SharePayload = {
  mode: "document" | "schema";
  format: Format;
  docText: string;
  schemaText: string;
  schema: SchemaRef | null;
};

export const encodeShare = (payload: SharePayload) =>
  LZString.compressToEncodedURIComponent(JSON.stringify(payload));

export function decodeShare(encoded: string): SharePayload | null {
  try {
    const json = LZString.decompressFromEncodedURIComponent(encoded);
    return json ? JSON.parse(json) : null;
  } catch {
    return null;
  }
}
