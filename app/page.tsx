import Link from "next/link";
import StatusBadge from "@/components/StatusBadge";
import Countdown from "@/components/Countdown";
import { requireUser } from "@/lib/guard";
import {
  getApprovalsForMany,
  listAreas,
  listPermits,
  pendingApprovalsFor,
  sweepExpired,
} from "@/lib/permits/repo";
import { PERMIT_TYPES, PERMIT_TYPE_KEYS, formatDateTime } from "@/lib/permits/registry";
import { STATUSES, STATUS_LABELS, isWindowExpired, type PermitStatus } from "@/lib/permits/state";

export const dynamic = "force-dynamic";

type Search = Record<string, string | string[] | undefined>;

function single(value: string | string[] | undefined): string {
  return Array.isArray(value) ? (value[0] ?? "") : (value ?? "");
}

export default async function DashboardPage({ searchParams }: { searchParams: Promise<Search> }) {
  const user = await requireUser();
  await sweepExpired();

  const query = await searchParams;
  const status = single(query.status) as PermitStatus | "";
  const type = single(query.type);
  const area = single(query.area);
  const from = single(query.from);
  const to = single(query.to);

  const scope = { role: user.role, id: user.id, areaId: user.areaId };
  const [all, areas] = await Promise.all([listPermits({ scope }), listAreas()]);

  const filtered = await listPermits({
    scope,
    status: status ? [status] : undefined,
    type: type && type in PERMIT_TYPES ? [type as keyof typeof PERMIT_TYPES] : undefined,
    areaId: area || undefined,
    from: from ? new Date(`${from}T00:00:00`).toISOString() : undefined,
    to: to ? new Date(`${to}T23:59:59`).toISOString() : undefined,
  });

  const approvals = await getApprovalsForMany(filtered.map((permit) => permit.id));
  const pendingMine = await pendingApprovalsFor(user);

  const active = all.filter((permit) => permit.status === "ACTIVE");
  const soon = active
    .filter((permit) => {
      const remaining = new Date(permit.planned_end).getTime() - Date.now();
      return remaining > 0 && remaining < 2 * 3_600_000;
    })
    .sort((a, b) => a.planned_end.localeCompare(b.planned_end));

  const waitingOnMe = pendingMine.length;

  return (
    <div>
      <div className="page-head">
        <div>
          <h1>Permits</h1>
          <div className="sub">
            {user.role === "REQUESTER"
              ? "Your permits. Anything active is listed first."
              : "Live status across the plant floor, newest window first."}
          </div>
        </div>
        <Link className="btn btn-primary" href="/permits/new">
          Raise a permit
        </Link>
      </div>

      <div className="stat-row">
        <div className="stat card" data-tone="ok">
          <div className="label">Active now</div>
          <div className="value">{active.length}</div>
          <div className="note">Work authorised and running</div>
        </div>
        <div className="stat card" data-tone={soon.length ? "warn" : undefined}>
          <div className="label">Expiring &lt; 2 h</div>
          <div className="value">{soon.length}</div>
          <div className="note">{soon.length ? "Renew or finish the job" : "Nothing about to lapse"}</div>
        </div>
        <div className="stat card">
          <div className="label">Waiting on you</div>
          <div className="value">{waitingOnMe}</div>
          <div className="note">
            <Link href="/approvals">{waitingOnMe ? "Open approvals" : "Nothing pending"}</Link>
          </div>
        </div>
        <div className="stat card">
          <div className="label">In view</div>
          <div className="value">{filtered.length}</div>
          <div className="note">{all.length} permitted to you</div>
        </div>
      </div>

      {soon.length ? (
        <div className="notice" data-tone="warn" style={{ marginBottom: 18 }}>
          <strong>
            {soon.length} permit{soon.length > 1 ? "s" : ""} expire within two hours.
          </strong>{" "}
          {soon
            .map((permit) => `${permit.code} (${PERMIT_TYPES[permit.type].short})`)
            .join(", ")}{" "}
          — the crew has to finish, extend, or stop.
        </div>
      ) : null}

      <div className="grid-2">
        <div className="card">
          <form className="filters" method="get">
            <div className="field">
              <label htmlFor="status">Status</label>
              <select id="status" name="status" defaultValue={status} className="input-sm">
                <option value="">Any</option>
                {STATUSES.map((value) => (
                  <option key={value} value={value}>
                    {STATUS_LABELS[value]}
                  </option>
                ))}
              </select>
            </div>
            <div className="field">
              <label htmlFor="type">Type</label>
              <select id="type" name="type" defaultValue={type} className="input-sm">
                <option value="">Any</option>
                {PERMIT_TYPE_KEYS.map((key) => (
                  <option key={key} value={key}>
                    {PERMIT_TYPES[key].short}
                  </option>
                ))}
              </select>
            </div>
            <div className="field">
              <label htmlFor="area">Area</label>
              <select id="area" name="area" defaultValue={area} className="input-sm">
                <option value="">Any</option>
                {areas.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="field">
              <label htmlFor="from">Window from</label>
              <input id="from" type="date" name="from" defaultValue={from} className="input-sm" />
            </div>
            <div className="field">
              <label htmlFor="to">to</label>
              <input id="to" type="date" name="to" defaultValue={to} className="input-sm" />
            </div>
            <button className="btn btn-sm" type="submit">
              Filter
            </button>
            {status || type || area || from || to ? (
              <Link className="btn btn-sm btn-ghost" href="/">
                Clear
              </Link>
            ) : null}
          </form>

          <div className="table-wrap">
            <table className="permits">
              <thead>
                <tr>
                  <th>Permit</th>
                  <th>Where</th>
                  <th>Window</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((permit) => {
                  const permitApprovals = approvals.filter((row) => row.permit_id === permit.id);
                  const waiting = permitApprovals.find((row) => row.decision === "PENDING");
                  const expired = isWindowExpired(permit.planned_end) && permit.status === "ACTIVE";
                  return (
                    <tr key={permit.id}>
                      <td>
                        <Link href={`/permits/${permit.id}`} className="title">
                          {PERMIT_TYPES[permit.type].short}
                        </Link>
                        <div className="meta">
                          <span className="mono">{permit.code}</span> · {permit.requesterName}
                        </div>
                      </td>
                      <td>
                        <div>{permit.areaName}</div>
                        <div className="meta">
                          {permit.equipmentTag ? `${permit.equipmentTag}` : "—"}
                        </div>
                      </td>
                      <td>
                        <div className="small">{formatDateTime(permit.planned_start)}</div>
                        <div className="meta">
                          ends {formatDateTime(permit.planned_end)}
                          {permit.status === "ACTIVE" ? (
                            <>
                              {" · "}
                              <Countdown endIso={permit.planned_end} />
                            </>
                          ) : null}
                        </div>
                      </td>
                      <td>
                        <StatusBadge status={permit.status} live={permit.status === "ACTIVE"} />
                        {permit.status === "PENDING_APPROVAL" && waiting ? (
                          <div className="meta">
                            waiting on {waiting.approver_role === "AREA_OWNER" ? "area owner" : "safety officer"}
                          </div>
                        ) : null}
                        {permit.status === "SUSPENDED" ? (
                          <div className="meta">work stopped</div>
                        ) : null}
                        {expired ? <div className="meta err">window passed</div> : null}
                      </td>
                    </tr>
                  );
                })}
                {!filtered.length ? (
                  <tr>
                    <td colSpan={4} className="muted" style={{ padding: 24 }}>
                      No permits match this filter.
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </div>

        <div className="stack">
          <div className="card">
            <div className="card-head">
              <h2>Expiring soon</h2>
              <span className="tiny muted">next 2 hours</span>
            </div>
            <div style={{ padding: soon.length ? "6px 0" : 18 }}>
              {soon.length ? (
                soon.map((permit) => (
                  <Link
                    key={permit.id}
                    href={`/permits/${permit.id}`}
                    style={{ display: "block", padding: "10px 18px", borderBottom: "1px solid var(--line)" }}
                  >
                    <div style={{ display: "flex", justifyContent: "space-between", gap: 10 }}>
                      <strong className="small">{PERMIT_TYPES[permit.type].short}</strong>
                      <Countdown endIso={permit.planned_end} className="small" />
                    </div>
                    <div className="tiny muted">
                      {permit.code} · {permit.areaName}
                    </div>
                  </Link>
                ))
              ) : (
                <p className="muted small" style={{ margin: 0 }}>
                  Nothing expiring in the next two hours.
                </p>
              )}
            </div>
          </div>

          <div className="card">
            <div className="card-head">
              <h2>Waiting on you</h2>
              <Link href="/approvals" className="tiny">
                Open
              </Link>
            </div>
            <div style={{ padding: pendingMine.length ? "6px 0" : 18 }}>
              {pendingMine.length ? (
                pendingMine.slice(0, 5).map((row) => (
                  <Link
                    key={`${row.permitId}-${row.role}`}
                    href={`/permits/${row.permitId}`}
                    style={{ display: "block", padding: "10px 18px", borderBottom: "1px solid var(--line)" }}
                  >
                    <div className="small mono">{row.code}</div>
                    <div className="tiny muted">
                      {row.role === "AREA_OWNER" ? "Area owner sign-off" : "Safety officer sign-off"}
                    </div>
                  </Link>
                ))
              ) : (
                <p className="muted small" style={{ margin: 0 }}>
                  Nothing waiting for your signature.
                </p>
              )}
            </div>
          </div>

          <div className="card card-pad">
            <h3 style={{ marginBottom: 6 }}>What this module enforces</h3>
            <ul className="small muted" style={{ margin: 0, paddingLeft: 18, lineHeight: 1.6 }}>
              <li>No work without every required signature.</li>
              <li>No start before the planned window opens.</li>
              <li>Expired permits never come back — raise a new one.</li>
              <li>You can never approve your own permit.</li>
            </ul>
          </div>
        </div>
      </div>
    </div>
  );
}
