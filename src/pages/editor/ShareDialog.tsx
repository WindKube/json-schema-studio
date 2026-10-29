import { useMutation, useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { type Invite, type Member, ROLES, type Role } from "../../../shared/api";
import { ago, api, queryClient } from "../../api";
import { Avatar, Dialog, ErrorText, srOnly } from "../../ui/ui";

const label = (r: Role) => r[0].toUpperCase() + r.slice(1);

export function ShareDialog({
  schemaId,
  title,
  role,
  publicVersions,
  onClose,
}: {
  schemaId: number;
  title: string;
  role: Role;
  publicVersions: boolean;
  onClose: () => void;
}) {
  const isOwner = role === "owner";
  const access = useQuery({
    queryKey: ["members", schemaId],
    queryFn: () =>
      api<{ members: Member[]; invites: Invite[] }>(`/api/schemas/${schemaId}/members`),
  });
  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ["members", schemaId] });
    queryClient.invalidateQueries({ queryKey: ["schemas"] });
  };

  const [login, setLogin] = useState("");
  const [inviteRole, setInviteRole] = useState<Role>("commenter");
  const invite = useMutation({
    mutationFn: () =>
      api<{ registered: boolean }>(`/api/schemas/${schemaId}/invites`, {
        body: { login, role: inviteRole },
      }),
    onSuccess: () => {
      setLogin("");
      refresh();
    },
  });

  const [linkRole, setLinkRole] = useState<Role>("commenter");
  const [link, setLink] = useState<string>();
  const [copied, setCopied] = useState(false);
  const makeLink = useMutation({
    mutationFn: () =>
      api<{ url: string }>(`/api/schemas/${schemaId}/invite-links`, { body: { role: linkRole } }),
    onSuccess: (r) => {
      setLink(r.url);
      setCopied(false);
      refresh();
    },
  });

  const change = useMutation({
    mutationFn: ({ userId, to }: { userId: number; to: Role | "remove" }) =>
      to === "remove"
        ? api(`/api/schemas/${schemaId}/members/${userId}`, { method: "DELETE", body: {} })
        : api(`/api/schemas/${schemaId}/members/${userId}`, { method: "PUT", body: { role: to } }),
    onSuccess: refresh,
  });
  const revoke = useMutation({
    mutationFn: (inviteId: number) =>
      api(`/api/schemas/${schemaId}/invites/${inviteId}`, { method: "DELETE", body: {} }),
    onSuccess: refresh,
  });
  const general = useMutation({
    mutationFn: (on: boolean) =>
      api(`/api/schemas/${schemaId}`, { method: "PATCH", body: { publicVersions: on } }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["schema", schemaId] }),
  });

  const pending = access.data?.invites ?? [];

  return (
    <Dialog title={`Share “${title}”`} onClose={onClose} width="max-w-[640px]">
      {isOwner && (
        <form
          className="flex flex-col gap-1.5"
          onSubmit={(e) => {
            e.preventDefault();
            invite.mutate();
          }}
        >
          <label htmlFor="inviteUser" className="field-label">
            Invite by GitHub username
          </label>
          <div className="flex flex-wrap gap-2">
            <input
              id="inviteUser"
              required
              value={login}
              onChange={(e) => setLogin(e.target.value)}
              placeholder="octocat"
              className="input h-11 flex-[1_1_220px] rounded-[10px]"
            />
            <label htmlFor="inviteRole" className={srOnly}>
              Role
            </label>
            <select
              id="inviteRole"
              value={inviteRole}
              onChange={(e) => setInviteRole(e.target.value as Role)}
              className="input h-11 rounded-[10px]"
            >
              {ROLES.map((r) => (
                <option key={r} value={r}>
                  {label(r)}
                </option>
              ))}
            </select>
            <button
              type="submit"
              className="btn-primary h-11 rounded-[10px]"
              disabled={invite.isPending}
            >
              Invite
            </button>
          </div>
          <ErrorText error={invite.error} />
          {invite.isSuccess && (
            <p role="status" className="m-0 text-[13px] text-ok">
              {invite.data.registered
                ? "Invited. They'll see it on their schema list."
                : "Invited. They'll see the invite after signing in with GitHub — send them the link to this site so they know to look."}
            </p>
          )}
        </form>
      )}

      <div className="flex flex-col gap-2">
        <span className="field-label">People with access</span>
        <ul className="m-0 list-none rounded-xl border border-line p-0">
          {access.data?.members.map((m, i) => (
            <li
              key={m.userId}
              className={`flex flex-wrap items-center gap-3 px-3.5 py-2.5 ${i ? "border-t border-line-soft" : ""}`}
            >
              <Avatar login={m.login} url={m.avatarUrl} />
              <span className="flex flex-[1_1_160px] flex-col">
                <span className="font-semibold">@{m.login}</span>
                <span className="text-xs text-muted">Joined {ago(m.since)}</span>
              </span>
              {isOwner ? (
                <label>
                  <span className={srOnly}>Role for @{m.login}</span>
                  <select
                    value={m.role}
                    onChange={(e) =>
                      change.mutate({ userId: m.userId, to: e.target.value as Role | "remove" })
                    }
                    className="h-9 rounded-lg border border-line-strong bg-surface px-2"
                  >
                    {ROLES.map((r) => (
                      <option key={r} value={r}>
                        {label(r)}
                      </option>
                    ))}
                    <option value="remove">Remove access</option>
                  </select>
                </label>
              ) : (
                <span className="text-ink-2">{label(m.role)}</span>
              )}
            </li>
          ))}
          {pending.map((inv) => (
            <li
              key={inv.id}
              className="flex flex-wrap items-center gap-3 border-t border-line-soft px-3.5 py-2.5"
            >
              <Avatar login={inv.login ?? "link"} url={inv.avatarUrl} />
              <span className="flex flex-[1_1_160px] flex-col">
                <span className="font-semibold">{inv.link ? "Invite link" : `@${inv.login}`}</span>
                <span className="text-xs text-muted">
                  Invite pending
                  {inv.expiresAt
                    ? ` · expires ${new Date(inv.expiresAt).toLocaleDateString()}`
                    : ""}
                </span>
              </span>
              <span className="text-ink-2">{label(inv.role)}</span>
              {isOwner && (
                <button type="button" className="btn" onClick={() => revoke.mutate(inv.id)}>
                  Revoke
                </button>
              )}
            </li>
          ))}
        </ul>
        <ErrorText error={change.error ?? access.error} />
        <p className="m-0 text-xs text-muted">
          Viewer: read and validate. Commenter: also comment and suggest. Editor: also edit and
          approve suggestions. Owner: also publish, share and delete.
        </p>
      </div>

      {isOwner && (
        <div className="flex flex-col gap-2">
          <span className="field-label">Invite link</span>
          <div className="flex flex-wrap gap-2">
            <label htmlFor="linkRole" className={srOnly}>
              Role for invite link
            </label>
            <select
              id="linkRole"
              value={linkRole}
              onChange={(e) => setLinkRole(e.target.value as Role)}
              className="input"
            >
              {ROLES.filter((r) => r !== "owner").map((r) => (
                <option key={r} value={r}>
                  {label(r)}
                </option>
              ))}
            </select>
            {link ? (
              <>
                <label htmlFor="inviteLink" className={srOnly}>
                  Invite link
                </label>
                <input
                  id="inviteLink"
                  readOnly
                  value={link}
                  className="input flex-[1_1_260px] bg-page font-mono text-[12.5px]"
                />
                <button
                  type="button"
                  className="btn h-10"
                  onClick={() => {
                    navigator.clipboard.writeText(link);
                    setCopied(true);
                  }}
                >
                  {copied ? "Copied" : "Copy link"}
                </button>
              </>
            ) : (
              <button
                type="button"
                className="btn h-10"
                onClick={() => makeLink.mutate()}
                disabled={makeLink.isPending}
              >
                Create link
              </button>
            )}
          </div>
          <span className="text-xs text-muted">
            Grants {label(linkRole)} access · expires in 7 days · single use · shown once
          </span>
          <ErrorText error={makeLink.error} />
        </div>
      )}

      <div className="flex flex-col gap-1.5">
        <label htmlFor="generalAccess" className="field-label">
          General access
        </label>
        <select
          id="generalAccess"
          disabled={!isOwner}
          value={publicVersions ? "public" : "private"}
          onChange={(e) => general.mutate(e.target.value === "public")}
          className="input h-11 rounded-[10px]"
        >
          <option value="private">Private: only people above</option>
          <option value="public">Published versions are public (read-only URL)</option>
        </select>
        <ErrorText error={general.error} />
      </div>
    </Dialog>
  );
}
