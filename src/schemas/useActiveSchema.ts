import { useEffect, useMemo, useState } from "react";
import { useStore } from "../store";
import { fetchSchema } from "./loader";

export type ActiveSchema = { uri: string; schema: object };

const CUSTOM_URI = "inmemory://schemas/custom.json";

type Result = { active: ActiveSchema | null; error: string | null; loading: boolean };

export function useActiveSchema(): Result {
  const ref = useStore((s) => s.schema);
  const schemaText = useStore((s) => s.schemaText);
  const remoteUrl = ref?.kind === "remote" ? ref.url : null;
  const [remote, setRemote] = useState<{ url: string; schema?: object; error?: string }>();

  useEffect(() => {
    if (!remoteUrl) return;
    let stale = false;
    setRemote({ url: remoteUrl });
    fetchSchema(remoteUrl).then(
      (schema) => !stale && setRemote({ url: remoteUrl, schema }),
      (e: Error) => !stale && setRemote({ url: remoteUrl, error: e.message }),
    );
    return () => {
      stale = true;
    };
  }, [remoteUrl]);

  const custom = useMemo((): Result | null => {
    if (ref?.kind !== "custom") return null;
    try {
      return {
        active: { uri: CUSTOM_URI, schema: JSON.parse(schemaText) },
        error: null,
        loading: false,
      };
    } catch {
      return { active: null, error: "The custom schema is not valid JSON.", loading: false };
    }
  }, [ref?.kind, schemaText]);

  const remoteActive = useMemo(
    () =>
      remote?.schema && remote.url === remoteUrl
        ? { uri: remote.url, schema: remote.schema }
        : null,
    [remote, remoteUrl],
  );

  if (custom) return custom;
  if (!remoteUrl) return { active: null, error: null, loading: false };
  if (remote?.url !== remoteUrl) return { active: null, error: null, loading: true };
  return {
    active: remoteActive,
    error: remote.error ?? null,
    loading: !remote.schema && !remote.error,
  };
}
