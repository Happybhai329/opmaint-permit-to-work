import Link from "next/link";
import ActionPanel from "@/components/ActionPanel";
import Countdown from "@/components/Countdown";
import StatusBadge from "@/components/StatusBadge";
import { requireUser } from "@/lib/guard";
import { getApprovals, getPermit, pendingApprovalsFor, sweepExpired } from "@/lib/permits/repo";
import { PERMIT_TYPES, evaluateGasReadings, formatDateTime } from "@/lib/permits/registry";
import { availableActions, type ApprovalLike } from "@/lib/permits/state";

export const dynamic = "force-dynamic";

/**
 * The approval screen an area owner or safety officer actually works from:
 * the job, the readings, the precautions — then a single decision.
 */
export default async function ApprovalsPage() {
  const user = await requireUser();
  await sweepExpired();

  const pending = await pendingApprovalsFor(user);
  const items = await Promise.all(
    pending.map(async (row) => {
      const permit = await getPermit(row.permitId);
      if (!permit) return null;
      const approvals = await getApprovals(row.permitId);
      const likes: ApprovalLike[] = approvals.map((approval) => ({
        approverRole: approval.approver_role,
        approverId: approval.approver_id,
        decision: approval.decision,
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
      );
      return { permit, role: row.role, actions, approvals };
    }),
  );

  const visible = items.filter((item): item is NonNullable<typeof item> => item !== null);

  return (
    <div>
      <div className="page-head">
        <div>
          <h1>Waiting for your signature</h1>
          <div className="sub">
            {user.role === "AREA_OWNER"
              ? "Only permits for equipment in your area appear here."
              : "Every permit that needs your role before work can start."}
          </div>
        </div>
      </div>

      {!visible.length ? (
        <div className="card card-pad">
          <p className="muted" style={{ margin: 0 }}>
            Nothing waiting. You will see a permit here the moment one is submitted that needs you.
          </p>
        </div>
      ) : null}

      <div className="stack">
        {visible.map(({ permit, actions }) => {
          const data = JSON.parse(permit.type_data) as Record<string, unknown>;
          const hazards = JSON.parse(permit.hazards) as string[];
          const precautions = JSON.parse(permit.precautions) as string[];
          const readings = evaluateGasReadings(permit.type, data);

          return (
            <div className="card" key={permit.id}>
              <div className="card-head">
                <div>
                  <div className="permit-code">{permit.code}</div>
                  <h2 style={{ marginTop: 2 }}>{PERMIT_TYPES[permit.type].label}</h2>
                </div>
                <div style={{ textAlign: "right" }}>
                  <StatusBadge status={permit.status} />
                  <div className="tiny muted" style={{ marginTop: 3 }}>
                    starts {formatDateTime(permit.planned_start)}
                  </div>
                </div>
              </div>

              <div style={{ padding: 18, display: "grid", gap: 14 }}>
                <div>
                  <div style={{ fontSize: 16, fontWeight: 600 }}>{permit.work_description}</div>
                  <div className="small muted">
                    {permit.plantName} · {permit.areaName}
                    {permit.equipmentTag ? ` · ${permit.equipmentTag}` : ""} ·{" "}
                    {permit.contractor ?? "own team"} · raised by {permit.requesterName}
                  </div>
                  <div className="small">
                    <Link href={`/permits/${permit.id}`}>Open the full permit →</Link>
                  </div>
                </div>

                {readings.length ? (
                  <div className="gas-row">
                    {readings.map((reading) => (
                      <div key={reading.label} className="gas-cell" data-state={reading.state}>
                        <div className="k">{reading.label}</div>
                        <div className="v">{reading.value}</div>
                      </div>
                    ))}
                  </div>
                ) : null}

                <div style={{ display: "grid", gap: 10 }}>
                  <div>
                    <div className="tiny muted" style={{ fontWeight: 600, letterSpacing: "0.05em" }}>
                      HAZARDS
                    </div>
                    <div className="chips" style={{ marginTop: 5 }}>
                      {hazards.map((hazard) => (
                        <span key={hazard} className="chip" data-warn="true">
                          {hazard}
                        </span>
                      ))}
                    </div>
                  </div>
                  <div>
                    <div className="tiny muted" style={{ fontWeight: 600, letterSpacing: "0.05em" }}>
                      PRECAUTIONS CLAIMED
                    </div>
                    <div className="chips" style={{ marginTop: 5 }}>
                      {precautions.map((item) => (
                        <span key={item} className="chip">
                          ✓ {item}
                        </span>
                      ))}
                    </div>
                  </div>
                  <div className="tiny muted">
                    Window closes{" "}
                    <Countdown endIso={permit.planned_end} />
                  </div>
                </div>

                <ActionPanel
                  permitId={permit.id}
                  actions={actions}
                  pendingExtensionHours={permit.pending_extension_hours}
                />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
