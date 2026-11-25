import type { AuditRow } from "@/lib/permits/repo";
import { formatDateTime } from "@/lib/permits/registry";

const ACTION_TEXT: Record<string, { label: string; tone?: "ok" | "danger" | "warn" }> = {
  create: { label: "Permit raised" },
  submit: { label: "Submitted for approval", tone: "warn" },
  approve: { label: "Approved", tone: "ok" },
  reject: { label: "Rejected", tone: "danger" },
  activate: { label: "Work started", tone: "ok" },
  suspend: { label: "Suspended", tone: "danger" },
  resume: { label: "Resumed", tone: "ok" },
  close: { label: "Marked complete" },
  verify: { label: "Verified & closed", tone: "ok" },
  cancel: { label: "Cancelled" },
  expire: { label: "Expired automatically", tone: "danger" },
  request_extension: { label: "Extension requested", tone: "warn" },
  approve_extension: { label: "Extension approved", tone: "ok" },
};

/**
 * The record that gets produced during an incident investigation. It is read
 * newest-first, in plain language, and never rendered as raw JSON.
 */
export default function AuditTimeline({ entries }: { entries: AuditRow[] }) {
  if (!entries.length) {
    return <p className="muted small" style={{ padding: 18 }}>No history yet.</p>;
  }

  return (
    <ol className="timeline" style={{ padding: "16px 18px 4px" }}>
      {entries.map((entry) => {
        const meta = ACTION_TEXT[entry.action] ?? { label: entry.action };
        return (
          <li key={entry.id} data-tone={meta.tone ?? "none"}>
            <div className="tl-head">
              <span className="tl-action">{meta.label}</span>
              <span className="tl-who">
                {entry.actor_label}
                {entry.actor_role && entry.actor_role !== "SYSTEM" ? (
                  <span className="muted"> · {titleCase(entry.actor_role)}</span>
                ) : null}
              </span>
              <span className="tl-when">{formatDateTime(entry.created_at)}</span>
            </div>
            {entry.comment ? <div className="tl-body">{entry.comment}</div> : null}
            {entry.field && (entry.from_value || entry.to_value) ? (
              <div className="tl-diff">
                {entry.field}: {entry.from_value ? formatValue(entry.field, entry.from_value) : "—"} →{" "}
                {entry.to_value ? formatValue(entry.field, entry.to_value) : "—"}
              </div>
            ) : null}
          </li>
        );
      })}
    </ol>
  );
}

function titleCase(value: string): string {
  return value
    .toLowerCase()
    .split("_")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

function formatValue(field: string, value: string): string {
  if (field === "planned_end" || field === "planned_start" || field.startsWith("gas_test_time")) {
    return formatDateTime(value);
  }
  return value;
}
