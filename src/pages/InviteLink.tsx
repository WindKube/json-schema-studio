import { useEffect, useRef, useState } from "react";
import { Redirect } from "wouter";
import { api, queryClient, useMe } from "../api";

export function InviteLink({ token }: { token: string }) {
  const me = useMe();
  const [result, setResult] = useState<{ schemaId?: number; error?: string }>();
  const started = useRef(false);

  useEffect(() => {
    if (!me.data || started.current) return;
    started.current = true;
    api<{ schemaId: number }>(`/api/invite-links/${encodeURIComponent(token)}/accept`, {
      body: {},
    }).then(
      (r) => {
        queryClient.invalidateQueries({ queryKey: ["schemas"] });
        setResult(r);
      },
      (e: Error) => setResult({ error: e.message }),
    );
  }, [me.data, token]);

  if (me.isPending) return <p className="p-6 text-muted">Loading…</p>;
  if (!me.data) return <Redirect to={`/login?next=${encodeURIComponent(`/invite/${token}`)}`} />;
  if (result?.schemaId) return <Redirect to={`/schemas/${result.schemaId}`} />;
  return (
    <div className="mx-auto flex max-w-md flex-col gap-3 p-10">
      {result?.error ? (
        <>
          <p role="alert" className="m-0 text-err">
            {result.error}
          </p>
          <a href="/">Go to my schemas</a>
        </>
      ) : (
        <p className="m-0 text-muted">Accepting invite…</p>
      )}
    </div>
  );
}
