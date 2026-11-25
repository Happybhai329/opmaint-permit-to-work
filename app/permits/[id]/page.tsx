import Link from "next/link";
import { notFound } from "next/navigation";
import ActionPanel from "@/components/ActionPanel";
import AuditTimeline from "@/components/AuditTimeline";
import Countdown from "@/components/Countdown";
import StatusBadge from "@/components/StatusBadge";
import { requireUser } from "@/lib/guard";
import { getApprovals, getAudit, getPermit, sweepExpired } from "@/lib/permits/repo";
import {
  PERMIT_TYPES,
  evaluateGasReadings,
  formatDateTime,
} from "@/lib/permits/registry";
import {
  availableActions,
  isWindowExpired,
  type ApprovalLike,
  type PermitAction,
} from "@/lib/permits/state";
import { ROLE_LABELS, type Role } from "@/lib/auth";

export const dynamic = "force-dynamic";

export default async function PermitDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  await sweepExpired();

  const { id } = await params;
  const permit = await getPermit(id);
  if (!permit) notFound();

  const canView =
    user.role === "ADMIN" ||
    user.role === "SAFETY_OFFICER" ||
    permit.requester_id === user.id ||
    (user.role === "AREA_OWNER" && permit.area_id === user.areaId);
  if (!canView) notFound();

  const [approvals, audit] = await Promise.all([getApprovals(id), getAudit(id)]);
  const likes: ApprovalLike[] = approvals.map((row) => ({
    approverRole: row.approver_role,
    approverId: row.approver_id,
    decision: row.decision,
  }));

  const actions = availableActions(
    {
      id: permit.id,
      type: permit.type,
      requesterId: permit.requester_id,
      areaId: permit.area_id,
      status: permit.status,
      plannedStart: permit.planned_start,
      plannedEnd: permit.planned_end,
      extensionCount: permit.extension_count,
      pendingExtensionHours: permit.pending_extension_hours,
    },
    { id: user.id, role: user.role, areaId: user.areaId },
    likes,
  ) as PermitAction[];

  const data = JSON.parse(permit.type_data) as Record<string, unknown>;
  const hazards = JSON.parse(permit.hazards) as string[];
  const ppe = JSON.parse(permit.ppe) as string[];
  const precautions = JSON.parse(permit.precautions) as string[];
  const readings = evaluateGasReadings(permit.type, data);
  const typeDef = PERMIT_TYPES[permit.type];

  const openActions = permit.status === "ACTIVE" || permit.status === "APPROVED";
  const rejected = approvals.find((row) => row.decision === "REJECTED");

  return (
    <div>
      <div className="page-head" style={{ marginBottom: 12 }}>
        <div>
          <Link href="/" className="small">
            ← All permits
          </Link>
        </div>
        <div className="small muted">
          Raised by {permit.requesterName} · {formatDateTime(permit.created_at)}
        </div>
      </div>

      <div className="card section">
        <div className="permit-head">
          <div>
            <div className="permit-code">
              {permit.code} · {typeDef.label} · {permit.areaName}
              {permit.equipmentTag ? ` · ${permit.equipmentTag}` : ""}
            </div>
            <h1 className="permit-title">{permit.work_description}</h1>
            <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
              <StatusBadge status={permit.status} live={permit.status === "ACTIVE"} />
              {openActions ? (
                <span className="small muted">
                  Window {formatDateTime(permit.planned_start)} →{" "}
                  <Countdown endIso={permit.planned_end} />
                </span>
              ) : (
                <span className="small muted">
                  Window {formatDateTime(permit.planned_start)} → {formatDateTime(permit.planned_end)}
                </span>
              )}
              {permit.contractor ? <span className="chip">{permit.contractor}</span> : null}
            </div>
          </div>
          <div style={{ minWidth: 220, maxWidth: 340 }}>
            <ActionPanel
              permitId={permit.id}
              actions={actions}
              pendingExtensionHours={permit.pending_extension_hours}
            />
          </div>
        </div>

        {permit.status === "SUSPENDED" ? (
          <div style={{ padding: "0 18px 18px" }}>
            <div className="notice" data-tone="danger">
              <strong>Work is stopped.</strong> {permit.suspended_reason}
            </div>
          </div>
        ) : null}

        {permit.status === "REJECTED" && rejected?.comment ? (
          <div style={{ padding: "0 18px 18px" }}>
            <div className="notice" data-tone="danger">
              <strong>Rejected by {rejected.approver_name ?? ROLE_LABELS[rejected.approver_role as Role]}.</strong>{" "}
              {rejected.comment}
            </div>
          </div>
        ) : null}

        {permit.status === "EXPIRED" ? (
          <div style={{ padding: "0 18px 18px" }}>
            <div className="notice" data-tone="warn">
              <strong>This permit expired.</strong> It cannot be reactivated — a new permit has to be
              raised for the same job.
            </div>
          </div>
        ) : null}

        {permit.status === "APPROVED" && isWindowExpired(permit.planned_end) ? (
          <div style={{ padding: "0 18px 18px" }}>
            <div className="notice" data-tone="warn">
              The approved window has passed, so this permit can no longer be started.
            </div>
          </div>
        ) : null}

        <dl className="kv" style={{ borderTop: "1px solid var(--line)" }}>
          <div>
            <dt>Requester</dt>
            <dd>{permit.requesterName}</dd>
          </div>
          <div>
            <dt>Contractor / team</dt>
            <dd>{permit.contractor ?? "Own team"}</dd>
          </div>
          <div>
            <dt>Location</dt>
            <dd>
              {permit.plantName} · {permit.areaName}
              {permit.location_details ? (
                <span className="muted small"> — {permit.location_details}</span>
              ) : null}
            </dd>
          </div>
          <div>
            <dt>Equipment</dt>
            <dd>{permit.equipmentTag ? `${permit.equipmentTag} — ${permit.equipmentName}` : "—"}</dd>
          </div>
          <div>
            <dt>Planned window</dt>
            <dd className="small">
              {formatDateTime(permit.planned_start)}
              <br />
              {formatDateTime(permit.planned_end)}
              {permit.extension_hours > 0 ? (
                <span className="muted"> (+{permit.extension_hours}h extended)</span>
              ) : null}
            </dd>
          </div>
          <div>
            <dt>Approvals required</dt>
            <dd className="small">{typeDef.approvers.map((role) => ROLE_LABELS[role]).join(" + ")}</dd>
          </div>
        </dl>
      </div>

      <div className="grid-2">
        <div className="stack">
          {readings.length ? (
            <div className="card">
              <div className="card-head">
                <h2>Atmospheric test</h2>
                <span className="tiny muted">
                  taken {formatDateTime(String(data.gas_test_time ?? ""))}
                </span>
              </div>
              <div style={{ padding: 18 }}>
                <div className="gas-row">
                  {readings.map((reading) => (
                    <div key={reading.label} className="gas-cell" data-state={reading.state}>
                      <div className="k">{reading.label}</div>
                      <div className="v">{reading.value}</div>
                      <div className="tiny muted">{reading.state === "pass" ? "within limit" : "outside limit"}</div>
                    </div>
                  ))}
                </div>
                <p className="tiny muted" style={{ marginTop: 10, marginBottom: 0 }}>
                  A test older than 60 minutes before the start window is refused by the server, not just
                  flagged.
                </p>
              </div>
            </div>
          ) : null}

          <div className="card">
            <div className="card-head">
              <h2>{typeDef.label} — job details</h2>
            </div>
            <dl className="kv">
              {typeDef.fields
                .filter((field) => field.group === "job")
                .map((field) => (
                  <div key={field.key}>
                    <dt>{field.label}</dt>
                    <dd>{renderValue(field.key, data[field.key], field.unit)}</dd>
                  </div>
                ))}
              {typeDef.fields
                .filter((field) => field.group === "safety")
                .map((field) => (
                  <div key={field.key}>
                    <dt>{field.label}</dt>
                    <dd>{renderValue(field.key, data[field.key], field.unit)}</dd>
                  </div>
                ))}
            </dl>
          </div>

          <div className="card">
            <div className="card-head">
              <h2>Hazards, PPE and precautions</h2>
            </div>
            <div style={{ padding: 18, display: "grid", gap: 16 }}>
              <div>
                <div className="tiny muted" style={{ marginBottom: 6, fontWeight: 600, letterSpacing: "0.05em" }}>
                  HAZARDS IDENTIFIED
                </div>
                <div className="chips">
                  {hazards.map((hazard) => (
                    <span key={hazard} className="chip" data-warn="true">
                      {hazard}
                    </span>
                  ))}
                </div>
              </div>
              <div>
                <div className="tiny muted" style={{ marginBottom: 6, fontWeight: 600, letterSpacing: "0.05em" }}>
                  PPE REQUIRED
                </div>
                <div className="chips">
                  {ppe.map((item) => (
                    <span key={item} className="chip">
                      {item}
                    </span>
                  ))}
                </div>
              </div>
              <div>
                <div className="tiny muted" style={{ marginBottom: 6, fontWeight: 600, letterSpacing: "0.05em" }}>
                  PRECAUTIONS IN PLACE
                </div>
                <div className="chips">
                  {precautions.map((item) => (
                    <span key={item} className="chip">
                      ✓ {item}
                    </span>
                  ))}
                </div>
              </div>
            </div>
          </div>

          {permit.status === "CLOSED" || permit.status === "CLOSED_VERIFIED" ? (
            <div className="card card-pad">
              <h2 style={{ fontSize: 15, marginBottom: 10 }}>Closure</h2>
              <div className="small" style={{ display: "grid", gap: 10 }}>
                <div>
                  <span className="muted">Work complete — </span>
                  {permit.close_notes ?? "—"}
                </div>
                <div>
                  <span className="muted">Verification — </span>
                  {permit.verification_notes ?? "Waiting for the safety officer."}
                </div>
              </div>
            </div>
          ) : null}
        </div>

        <div className="stack">
          <div className="card">
            <div className="card-head">
              <h2>Approvals</h2>
              <span className="tiny muted">
                {approvals.filter((row) => row.decision === "APPROVED").length}/{approvals.length} signed
              </span>
            </div>
            {approvals.length ? (
              approvals.map((approval) => (
                <div className="approval" key={approval.id}>
                  <div className="avatar">
                    {initials(approval.approver_name ?? ROLE_LABELS[approval.approver_role as Role])}
                  </div>
                  <div style={{ flex: 1 }}>
                    <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
                      <div>
                        <div className="role">{ROLE_LABELS[approval.approver_role as Role]}</div>
                        <div className="small">
                          {approval.approver_name ?? "Not signed yet"}
                        </div>
                      </div>
                      <span
                        className="badge"
                        data-tone={
                          approval.decision === "APPROVED"
                            ? "ok"
                            : approval.decision === "REJECTED"
                              ? "danger"
                              : "neutral"
                        }
                      >
                        {approval.decision === "APPROVED"
                          ? "Approved"
                          : approval.decision === "REJECTED"
                            ? "Rejected"
                            : "Pending"}
                      </span>
                    </div>
                    {approval.comment ? <div className="tl-body small">{approval.comment}</div> : null}
                    {approval.decided_at ? (
                      <div className="tiny muted">{formatDateTime(approval.decided_at)}</div>
                    ) : null}
                  </div>
                </div>
              ))
            ) : (
              <p className="muted small" style={{ padding: 18 }}>
                Approvals are created when the permit is submitted.
              </p>
            )}
          </div>

          <div className="card">
            <div className="card-head">
              <h2>Audit trail</h2>
              <span className="tiny muted">{audit.length} entries · immutable</span>
            </div>
            <AuditTimeline entries={audit} />
          </div>
        </div>
      </div>
    </div>
  );
}

function renderValue(key: string, value: unknown, unit?: string): string {
  if (value === undefined || value === null || value === "") return "—";
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (key === "gas_test_time") return formatDateTime(String(value));
  if (key === "gas_o2_percent" || key === "gas_lel_percent") return `${String(value)} ${unit ?? ""}`;
  return `${String(value)}${unit ? ` ${unit}` : ""}`;
}

function initials(name: string): string {
  return name
    .split(" ")
    .map((part) => part.charAt(0))
    .slice(0, 2)
    .join("")
    .toUpperCase();
}
