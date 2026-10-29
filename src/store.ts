import { create } from "zustand";
import { persist } from "zustand/middleware";
import { convert, type Format } from "./format";
import type { SharePayload } from "./share";

export type SchemaRef = { kind: "remote"; name: string; url: string } | { kind: "custom" };

type Remote = { name: string; url: string };

type State = {
  mode: "document" | "schema";
  format: Format;
  docText: string;
  schemaText: string;
  schema: SchemaRef | null;
  recent: Remote[];
  schemaView: "visual" | "source";
  docView: "form" | "code";
  past: string[];
  future: string[];
  setMode: (mode: State["mode"]) => void;
  setFormat: (format: Format) => void;
  setDocText: (text: string) => void;
  setSchemaText: (text: string) => void;
  editSchema: (text: string) => void;
  undo: () => void;
  redo: () => void;
  setSchemaView: (view: State["schemaView"]) => void;
  setDocView: (view: State["docView"]) => void;
  selectRemote: (remote: Remote) => void;
  clearSchema: () => void;
  applyCustomSchema: () => void;
  load: (payload: SharePayload) => void;
};

const STARTER_SCHEMA = `{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "type": "object",
  "properties": {
    "name": { "type": "string", "description": "Display name" },
    "tags": { "type": "array", "items": { "type": "string" } }
  },
  "required": ["name"]
}
`;

export const useStore = create<State>()(
  persist(
    (set, get) => ({
      mode: "document",
      format: "yaml",
      docText: "",
      schemaText: STARTER_SCHEMA,
      schema: null,
      recent: [],
      schemaView: "visual",
      docView: "code",
      past: [],
      future: [],
      setMode: (mode) => set({ mode }),
      setFormat: (format) => set({ format, docText: convert(get().docText, get().format, format) }),
      setDocText: (docText) => set({ docText }),
      setSchemaText: (schemaText) => set({ schemaText }),
      editSchema: (text) =>
        set((s) => ({ schemaText: text, past: [...s.past, s.schemaText].slice(-100), future: [] })),
      undo: () =>
        set((s) =>
          s.past.length
            ? {
                schemaText: s.past[s.past.length - 1],
                past: s.past.slice(0, -1),
                future: [s.schemaText, ...s.future],
              }
            : {},
        ),
      redo: () =>
        set((s) =>
          s.future.length
            ? {
                schemaText: s.future[0],
                past: [...s.past, s.schemaText],
                future: s.future.slice(1),
              }
            : {},
        ),
      setSchemaView: (schemaView) => set({ schemaView }),
      setDocView: (docView) => set({ docView }),
      selectRemote: ({ name, url }) =>
        set({
          schema: { kind: "remote", name, url },
          recent: [{ name, url }, ...get().recent.filter((r) => r.url !== url)].slice(0, 8),
        }),
      clearSchema: () => set({ schema: null }),
      applyCustomSchema: () => set({ schema: { kind: "custom" }, mode: "document" }),
      load: (payload) => set(payload),
    }),
    {
      name: "json-schema-studio-playground",
      partialize: ({ mode, format, docText, schemaText, schema, recent, schemaView, docView }) => ({
        mode,
        format,
        docText,
        schemaText,
        schema,
        recent,
        schemaView,
        docView,
      }),
    },
  ),
);
