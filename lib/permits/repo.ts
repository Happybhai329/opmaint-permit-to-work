import { db, newId, nowIso } from "../db";
import type { Role } from "../auth";
import type { PermitStatus } from "../permits/state";
import { PERMIT_TYPES, type PermitTypeKey } from "../permits/registry";

export type PermitRow = {
  id: string;
  code: string;
  type: PermitTypeKey;
  plant_id: string;
  area_id: string;
  equipment_id: string | null;
  requester_id: string;
  contractor: string | null;
  work_description: string;
  location_details: string | null;
  planned_start: string;
  planned_end: string;
  hazards: string;
  ppe: string;
  precautions: string;
  type_data: string;
  status: PermitStatus;
  close_notes: string | null;
  verification_notes: string | null;
  extension_hours: number;
  extension_count: number;
  pending_extension_hours: number;
  suspended_reason: string | null;
  created_at: string;
  updated_at: string;
  submitted_at: string | null;
  approved_at: string | null;
  active_at: string | null;
  suspended_at: string | null;
  closed_at: string | null;
};

export type Permit = PermitRow & {
  requesterName: string;
  areaName: string;
  plantName: string;
  equipmentTag: string | null;
  equipmentName: string | null;
};

export type ApprovalRow = {
  id: string;
  permit_id: string;
  approver_role: Role;
  approver_id: string | null;
  decision: "PENDING" | "APPROVED" | "REJECTED";
  comment: string | null;
  decided_at: string | null;
  created_at: string;
  approver_name?: string | null;
};

export type AuditRow = {
  id: string;
  permit_id: string;
  actor_id: string | null;
  actor_label: string;
  actor_role: string;
  action: string;
  field: string | null;
  from_value: string | null;
  to_value: string | null;
  comment: string | null;
  created_at: string;
};

const PERMIT_SELECT = `
  SELECT p.*,
         u.name AS requester_name,
         a.name AS area_name,
         pl.name AS plant_name,
         e.tag AS equipment_tag,
         e.name AS equipment_name
    FROM permits p
    JOIN users u ON u.id = p.requester_id
    JOIN areas a ON a.id = p.area_id
    JOIN plants pl ON pl.id = p.plant_id
    LEFT JOIN equipment e ON e.id = p.equipment_id
`;

function mapPermit(row: Record<string, unknown>): Permit {
  const base = row as unknown as PermitRow & {
    requester_name: string;
    area_name: string;
    plant_name: string;
    equipment_tag: string | null;
    equipment_name: string | null;
  };
  return {
    ...base,
    requesterName: base.requester_name,
    areaName: base.area_name,
    plantName: base.plant_name,
    equipmentTag: base.equipment_tag,
    equipmentName: base.equipment_name,
  };
}

export type ListFilter = {
  status?: PermitStatus[];
  type?: PermitTypeKey[];
  areaId?: string;
  from?: string;
  to?: string;
  scope?: { role: Role; id: string; areaId: string | null };
};

export async function listPermits(filter: ListFilter = {}): Promise<Permit[]> {
  const handle = await db();
  const where: string[] = [];
  const params: (string | number)[] = [];

  if (filter.status?.length) {
    where.push(`p.status IN (${filter.status.map(() => "?").join(",")})`);
    params.push(...filter.status);
  }
  if (filter.type?.length) {
    where.push(`p.type IN (${filter.type.map(() => "?").join(",")})`);
    params.push(...filter.type);
  }
  if (filter.areaId) {
    where.push("p.area_id = ?");
    params.push(filter.areaId);
  }
  if (filter.from) {
    where.push("p.planned_end >= ?");
    params.push(filter.from);
  }
  if (filter.to) {
    where.push("p.planned_start <= ?");
    params.push(filter.to);
  }
  if (filter.scope) {
    if (filter.scope.role === "REQUESTER") {
      where.push("p.requester_id = ?");
      params.push(filter.scope.id);
    } else if (filter.scope.role === "AREA_OWNER") {
      where.push("p.area_id = ?");
      params.push(filter.scope.areaId ?? "__none__");
    }
  }

  const sql = `${PERMIT_SELECT} ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
               ORDER BY CASE p.status
                 WHEN 'ACTIVE' THEN 0 WHEN 'PENDING_APPROVAL' THEN 1 WHEN 'SUSPENDED' THEN 2
                 WHEN 'APPROVED' THEN 3 WHEN 'CLOSED' THEN 4 ELSE 5 END,
                 p.planned_start DESC`;
  const result = await handle
    .prepare(sql)
    .bind(...params)
    .all<Record<string, unknown>>();
  return (result.results ?? []).map(mapPermit);
}

export async function getPermit(id: string): Promise<Permit | null> {
  const handle = await db();
  const row = await handle
    .prepare(`${PERMIT_SELECT} WHERE p.id = ?`)
    .bind(id)
    .first<Record<string, unknown>>();
  return row ? mapPermit(row) : null;
}

export async function getPermitByCode(code: string): Promise<Permit | null> {
  const handle = await db();
  const row = await handle
    .prepare(`${PERMIT_SELECT} WHERE p.code = ?`)
    .bind(code)
    .first<Record<string, unknown>>();
  return row ? mapPermit(row) : null;
}

export async function getApprovals(permitId: string): Promise<ApprovalRow[]> {
  const handle = await db();
  const result = await handle
    .prepare(
      `SELECT ap.*, u.name AS approver_name
         FROM approvals ap LEFT JOIN users u ON u.id = ap.approver_id
        WHERE ap.permit_id = ?
        ORDER BY CASE ap.approver_role WHEN 'AREA_OWNER' THEN 0 ELSE 1 END`,
    )
    .bind(permitId)
    .all<ApprovalRow>();
  return result.results ?? [];
}

export async function getApprovalsForMany(permitIds: string[]): Promise<ApprovalRow[]> {
  if (!permitIds.length) return [];
  const handle = await db();
  const result = await handle
    .prepare(
      `SELECT ap.*, u.name AS approver_name
         FROM approvals ap LEFT JOIN users u ON u.id = ap.approver_id
        WHERE ap.permit_id IN (${permitIds.map(() => "?").join(",")})
        ORDER BY CASE ap.approver_role WHEN 'AREA_OWNER' THEN 0 ELSE 1 END`,
    )
    .bind(...permitIds)
    .all<ApprovalRow>();
  return result.results ?? [];
}

/**
 * Permits sitting on this person's desk.
 * Area owners only see their own area; admins see every pending approval.
 */
export async function pendingApprovalsFor(user: {
  id: string;
  role: Role;
  areaId: string | null;
}): Promise<{ permitId: string; code: string; role: Role }[]> {
  const handle = await db();
  const result = await handle
    .prepare(
      `SELECT p.id AS permit_id, p.code, a.approver_role AS role
         FROM permits p JOIN approvals a ON a.permit_id = p.id
        WHERE p.status = 'PENDING_APPROVAL'
          AND a.decision = 'PENDING'
          AND p.requester_id <> ?
          AND (? = 'ADMIN' OR a.approver_role = ?)
          AND (? <> 'AREA_OWNER' OR p.area_id = ?)
        ORDER BY p.planned_start ASC`,
    )
    .bind(user.id, user.role, user.role, user.role, user.areaId ?? "__none__")
    .all<{ permit_id: string; code: string; role: Role }>();
  return (result.results ?? []).map((row) => ({ permitId: row.permit_id, code: row.code, role: row.role }));
}

export async function getAudit(permitId: string): Promise<AuditRow[]> {
  const handle = await db();
  const result = await handle
    .prepare("SELECT * FROM audit_log WHERE permit_id = ? ORDER BY created_at DESC, rowid DESC")
    .bind(permitId)
    .all<AuditRow>();
  return result.results ?? [];
}

export async function getAuditFor(permitIds: string[]): Promise<AuditRow[]> {
  if (!permitIds.length) return [];
  const handle = await db();
  const result = await handle
    .prepare(
      `SELECT * FROM audit_log WHERE permit_id IN (${permitIds.map(() => "?").join(",")})
        ORDER BY created_at DESC, rowid DESC LIMIT 200`,
    )
    .bind(...permitIds)
    .all<AuditRow>();
  return result.results ?? [];
}

export type NewPermit = {
  code: string;
  type: PermitTypeKey;
  plantId: string;
  areaId: string;
  equipmentId: string | null;
  requesterId: string;
  contractor: string | null;
  workDescription: string;
  locationDetails: string | null;
  plannedStart: string;
  plannedEnd: string;
  hazards: string[];
  ppe: string[];
  precautions: string[];
  typeData: Record<string, unknown>;
  status: PermitStatus;
  createdAt: string;
};

export async function nextPermitCode(): Promise<string> {
  const handle = await db();
  const year = new Date().getUTCFullYear();
  const row = await handle
    .prepare("SELECT COUNT(*) AS count FROM permits WHERE code LIKE ?")
    .bind(`PTW-${year}-%`)
    .first<{ count: number }>();
  const next = (row?.count ?? 0) + 1;
  return `PTW-${year}-${String(next).padStart(4, "0")}`;
}

export async function insertPermit(permit: NewPermit): Promise<string> {
  const handle = await db();
  const id = newId();
  await handle
    .prepare(
      `INSERT INTO permits (
         id, code, type, plant_id, area_id, equipment_id, requester_id, contractor,
         work_description, location_details, planned_start, planned_end, hazards, ppe,
         precautions, type_data, status, created_at, updated_at
       ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    )
    .bind(
      id,
      permit.code,
      permit.type,
      permit.plantId,
      permit.areaId,
      permit.equipmentId,
      permit.requesterId,
      permit.contractor,
      permit.workDescription,
      permit.locationDetails,
      permit.plannedStart,
      permit.plannedEnd,
      JSON.stringify(permit.hazards),
      JSON.stringify(permit.ppe),
      JSON.stringify(permit.precautions),
      JSON.stringify(permit.typeData),
      permit.status,
      permit.createdAt,
      permit.createdAt,
    )
    .run();
  return id;
}

export function insertApprovalStatements(
  handle: D1Database,
  permitId: string,
  roles: Role[],
  createdAt: string,
): D1PreparedStatement[] {
  return roles.map((role) =>
    handle
      .prepare(
        `INSERT OR IGNORE INTO approvals
           (id, permit_id, approver_role, approver_id, decision, created_at)
         VALUES (?,?,?,NULL,'PENDING',?)`,
      )
      .bind(newId(), permitId, role, createdAt),
  );
}

export function auditStatement(
  handle: D1Database,
  input: {
    permitId: string;
    actorId: string | null;
    actorLabel: string;
    actorRole: string;
    action: string;
    field?: string | null;
    from?: string | null;
    to?: string | null;
    comment?: string | null;
    at?: string;
  },
): D1PreparedStatement {
  return handle
    .prepare(
      `INSERT INTO audit_log
         (id, permit_id, actor_id, actor_label, actor_role, action, field, from_value, to_value, comment, created_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
    )
    .bind(
      newId(),
      input.permitId,
      input.actorId,
      input.actorLabel,
      input.actorRole,
      input.action,
      input.field ?? null,
      input.from ?? null,
      input.to ?? null,
      input.comment ?? null,
      input.at ?? nowIso(),
    );
}

/**
 * Expiry is a server fact, not a UI countdown: anybody loading the list, the
 * detail page, or calling the API first causes overdue permits to be closed
 * out. A scheduled Worker cron would call the same function every minute in
 * production; see README.
 */
export async function sweepExpired(): Promise<number> {
  const handle = await db();
  const now = nowIso();
  const due = await handle
    .prepare(
      `SELECT p.id, p.status, p.code, p.planned_end FROM permits p
        WHERE p.status IN ('PENDING_APPROVAL','APPROVED','ACTIVE','SUSPENDED')
          AND p.planned_end <= ?`,
    )
    .bind(now)
    .all<{ id: string; status: PermitStatus; code: string; planned_end: string }>();

  const rows = due.results ?? [];
  if (!rows.length) return 0;

  const statements: D1PreparedStatement[] = [];
  for (const row of rows) {
    statements.push(
      handle
        .prepare("UPDATE permits SET status = 'EXPIRED', updated_at = ? WHERE id = ? AND status = ?")
        .bind(now, row.id, row.status),
    );
    statements.push(
      auditStatement(handle, {
        permitId: row.id,
        actorId: null,
        actorLabel: "System",
        actorRole: "SYSTEM",
        action: "expire",
        from: row.status,
        to: "EXPIRED",
        comment: `Validity window ended at ${row.planned_end}.`,
        at: now,
      }),
    );
  }
  await handle.batch(statements);
  return rows.length;
}

/* ------------------------------- reference data ------------------------------ */

export type Area = { id: string; plantId: string; name: string; code: string; plantName: string };
export type Equipment = { id: string; areaId: string; tag: string; name: string };

export async function listAreas(): Promise<Area[]> {
  const handle = await db();
  const result = await handle
    .prepare(
      `SELECT a.id, a.plant_id, a.name, a.code, p.name AS plant_name
         FROM areas a JOIN plants p ON p.id = a.plant_id
        ORDER BY p.name, a.name`,
    )
    .all<{ id: string; plant_id: string; name: string; code: string; plant_name: string }>();
  return (result.results ?? []).map((row) => ({
    id: row.id,
    plantId: row.plant_id,
    name: row.name,
    code: row.code,
    plantName: row.plant_name,
  }));
}

export async function listEquipment(): Promise<Equipment[]> {
  const handle = await db();
  const result = await handle
    .prepare("SELECT id, area_id, tag, name FROM equipment ORDER BY tag")
    .all<{ id: string; area_id: string; tag: string; name: string }>();
  return (result.results ?? []).map((row) => ({
    id: row.id,
    areaId: row.area_id,
    tag: row.tag,
    name: row.name,
  }));
}

export async function listUsers(): Promise<
  { id: string; name: string; email: string; role: Role }[]
> {
  const handle = await db();
  const result = await handle
    .prepare("SELECT id, name, email, role FROM users ORDER BY role, name")
    .all<{ id: string; name: string; email: string; role: Role }>();
  return result.results ?? [];
}

/** Types that must not run at the same time in the same area. */
export async function findConflicts(input: {
  permitId?: string;
  areaId: string;
  type: PermitTypeKey;
  plannedStart: string;
  plannedEnd: string;
}): Promise<{ id: string; code: string; type: PermitTypeKey; planned_start: string; planned_end: string }[]> {
  const conflictsWith = PERMIT_TYPES[input.type].conflictsWith;
  if (!conflictsWith.length) return [];
  const handle = await db();
  const types = [...conflictsWith];
  const params: string[] = [input.areaId, ...types, input.plannedEnd, input.plannedStart];
  const exclude = input.permitId ? "AND p.id <> ?" : "";
  if (input.permitId) params.push(input.permitId);

  const result = await handle
    .prepare(
      `SELECT p.id, p.code, p.type, p.planned_start, p.planned_end
         FROM permits p
        WHERE p.area_id = ?
          AND p.type IN (${types.map(() => "?").join(",")})
          AND p.status IN ('PENDING_APPROVAL','APPROVED','ACTIVE','SUSPENDED')
          AND p.planned_start < ?
          AND p.planned_end > ?
          ${exclude}`,
    )
    .bind(...params)
    .all<{ id: string; code: string; type: PermitTypeKey; planned_start: string; planned_end: string }>();
  return result.results ?? [];
}
