"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ACTION_LABELS, type PermitAction } from "@/lib/permits/state";

type Props = {
  permitId: string;
  actions: PermitAction[];
  pendingExtensionHours: number;
  verifyMode?: "full" | "compact";
};

const CONFIRM: Partial<Record<PermitAction, { label: string; placeholder: string; field: "comment" | "notes" | "reason" }>> = {
  reject: { label: "Why are you rejecting this permit?", placeholder: "Say exactly what is missing so the requester can fix it.", field: "comment" },
  suspend: { label: "Why is work stopping?", placeholder: "e.g. Gas alarm in the area, work stopped and area cleared.", field: "reason" },
  close: { label: "What was actually done?", placeholder: "Work completed, materials used, area left in what state.", field: "notes" },
  verify: { label: "Verification note", placeholder: "Area inspected and clean, no hot spots, permit handed back.", field: "notes" },
  cancel: { label: "Reason for cancelling (optional)", placeholder: "Job cancelled, contractor stood down…", field: "comment" },
};

export default function ActionPanel({ permitId, actions, pendingExtensionHours }: Props) {
  const router = useRouter();
  const [open, setOpen] = useState<PermitAction | null>(null);
  const [value, setValue] = useState("");
  const [hours, setHours] = useState(2);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!actions.length && pendingExtensionHours <= 0) {
    return (
      <p className="muted small" style={{ margin: 0 }}>
        No actions available to you on this permit right now.
      </p>
    );
  }

  async function send(action: PermitAction, extra: Record<string, unknown> = {}) {
    setBusy(true);
    setError(null);
    const response = await fetch(`/api/permits/${permitId}/actions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action, ...extra }),
    });
    const data = (await response.json().catch(() => ({}))) as { error?: string };
    setBusy(false);
    if (!response.ok) {
      setError(data.error ?? "That action was refused.");
      return;
    }
    setOpen(null);
    setValue("");
    router.refresh();
  }

  const confirm = open ? CONFIRM[open] : undefined;

  return (
    <div>
      <div className="btn-row">
        {actions.map((action) => {
          const meta = CONFIRM[action];
          // Cancel is destructive but rarely the right button mid-job, so it is
          // not dressed in the same red as stopping live work.
          const tone =
            action === "reject" || action === "suspend"
              ? "btn btn-danger"
              : action === "submit" || action === "activate" || action === "approve" || action === "verify"
                ? "btn btn-primary"
                : "btn";
          if (meta) {
            return (
              <button
                key={action}
                className={tone}
                type="button"
                onClick={() => {
                  setOpen(open === action ? null : action);
                  setValue("");
                  setError(null);
                }}
              >
                {ACTION_LABELS[action]}
              </button>
            );
          }
          if (action === "request_extension") {
            return (
              <button
                key={action}
                className="btn"
                type="button"
                onClick={() => {
                  setOpen(open === action ? null : action);
                  setError(null);
                }}
              >
                Request extension
              </button>
            );
          }
          return (
            <button
              key={action}
              className={tone}
              type="button"
              disabled={busy}
              onClick={() => send(action)}
            >
              {ACTION_LABELS[action]}
            </button>
          );
        })}
      </div>

      {open && confirm ? (
        <div className="card" style={{ marginTop: 12, padding: 14 }}>
          <div className="field">
            <label htmlFor={`confirm-${open}`}>{confirm.label}</label>
            <textarea
              id={`confirm-${open}`}
              value={value}
              onChange={(event) => setValue(event.target.value)}
              placeholder={confirm.placeholder}
              autoFocus
            />
          </div>
          {error ? <div className="notice" data-tone="danger" style={{ marginTop: 10 }}>{error}</div> : null}
          <div className="btn-row" style={{ marginTop: 10, justifyContent: "flex-end" }}>
            <button className="btn" type="button" onClick={() => setOpen(null)}>
              Back
            </button>
            <button
              className={open === "reject" || open === "suspend" ? "btn btn-danger" : "btn btn-primary"}
              type="button"
              disabled={busy || !value.trim()}
              onClick={() => send(open, { [confirm.field]: value })}
            >
              {busy ? "Saving…" : ACTION_LABELS[open]}
            </button>
          </div>
        </div>
      ) : null}

      {open === "request_extension" ? (
        <div className="card" style={{ marginTop: 12, padding: 14 }}>
          <div className="field">
            <label htmlFor="hours">Extra hours needed (max 4, re-approved by the safety officer)</label>
            <input
              id="hours"
              type="number"
              min={1}
              max={4}
              value={hours}
              onChange={(event) => setHours(Number(event.target.value))}
              style={{ maxWidth: 140 }}
            />
          </div>
          {error ? <div className="notice" data-tone="danger" style={{ marginTop: 10 }}>{error}</div> : null}
          <div className="btn-row" style={{ marginTop: 10, justifyContent: "flex-end" }}>
            <button className="btn" type="button" onClick={() => setOpen(null)}>
              Back
            </button>
            <button className="btn btn-primary" type="button" disabled={busy} onClick={() => send("request_extension", { hours })}>
              {busy ? "Sending…" : "Send for re-approval"}
            </button>
          </div>
        </div>
      ) : null}

      {pendingExtensionHours > 0 ? (
        <div className="notice" data-tone="warn" style={{ marginTop: 12 }}>
          Extension of {pendingExtensionHours}h is waiting for the safety officer.
          {actions.includes("approve_extension") ? (
            <span className="btn-row" style={{ marginTop: 10 }}>
              <button className="btn btn-sm btn-primary" type="button" disabled={busy} onClick={() => send("approve_extension")}>
                Approve extension
              </button>
              <button
                className="btn btn-sm"
                type="button"
                disabled={busy}
                onClick={() => send("reject", { comment: "Extension refused — the window closes and the job must be re-permitted." })}
              >
                Refuse
              </button>
            </span>
          ) : null}
        </div>
      ) : null}

      {error && !open ? <div className="notice" data-tone="danger" style={{ marginTop: 12 }}>{error}</div> : null}
    </div>
  );
}
