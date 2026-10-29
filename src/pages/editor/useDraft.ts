import { useCallback, useEffect, useRef, useState } from "react";
import type { Conflict, SchemaDetail } from "../../../shared/api";
import type { Format } from "../../../shared/patch";
import { ApiError, api, queryClient } from "../../api";

export type SaveStatus = "saved" | "dirty" | "saving" | "error";

// Autosaves the draft ~1.5 s after the last edit; a concurrent save elsewhere surfaces as a conflict
// instead of silently overwriting it (no realtime co-editing).
export function useDraft(detail: SchemaDetail) {
  const id = detail.schema.id;
  const [text, setTextState] = useState(detail.draft.text);
  const [format, setFormat] = useState<Format>(detail.schema.format);
  const [status, setStatus] = useState<SaveStatus>("saved");
  const [savedAt, setSavedAt] = useState(detail.draft.updatedAt);
  const [conflict, setConflict] = useState<Conflict | null>(null);
  const [error, setError] = useState<string>();
  const revision = useRef(detail.draft.revision);
  const latest = useRef({ text, format });
  latest.current = { text, format };

  useEffect(() => {
    if (status === "saved" && detail.draft.revision > revision.current) {
      revision.current = detail.draft.revision;
      setTextState(detail.draft.text);
      setFormat(detail.schema.format);
      setSavedAt(detail.draft.updatedAt);
    }
  }, [detail, status]);

  const setText = useCallback((next: string, nextFormat?: Format) => {
    setTextState(next);
    if (nextFormat) setFormat(nextFormat);
    setStatus("dirty");
  }, []);

  const save = useCallback(async () => {
    const sent = latest.current;
    setStatus("saving");
    try {
      const r = await api<{ revision: number; updatedAt: number }>(`/api/schemas/${id}/draft`, {
        method: "PUT",
        body: { text: sent.text, format: sent.format, revision: revision.current },
      });
      revision.current = r.revision;
      setSavedAt(r.updatedAt);
      setError(undefined);
      const changedMeanwhile =
        latest.current.text !== sent.text || latest.current.format !== sent.format;
      setStatus(changedMeanwhile ? "dirty" : "saved");
      queryClient.invalidateQueries({ queryKey: ["schemas"] });
      queryClient.invalidateQueries({ queryKey: ["schema", id] });
    } catch (e) {
      if (e instanceof ApiError && e.status === 409) setConflict(e.data as Conflict);
      setError((e as Error).message);
      setStatus("error");
    }
  }, [id]);

  useEffect(() => {
    if (status !== "dirty") return;
    const timer = setTimeout(save, 1500);
    return () => clearTimeout(timer);
  }, [status, save]);

  // Leaving the editor inside the app unmounts it before the debounce fires; save right away instead.
  const pending = useRef(false);
  pending.current = status === "dirty";
  useEffect(
    () => () => {
      if (pending.current) save();
    },
    [save],
  );

  useEffect(() => {
    if (status === "saved") return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [status]);

  const resolveConflict = (keep: "mine" | "theirs") => {
    if (!conflict) return;
    revision.current = conflict.revision;
    if (keep === "theirs") {
      setTextState(conflict.text);
      setStatus("saved");
      queryClient.invalidateQueries({ queryKey: ["schema", id] });
    } else {
      setStatus("dirty");
    }
    setConflict(null);
    setError(undefined);
  };

  return { text, format, setText, status, savedAt, conflict, error, resolveConflict, revision };
}
