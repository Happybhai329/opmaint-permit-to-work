import { z } from "zod";
import { db, newId, nowIso } from "../db";
import type { SessionUser } from "../auth";
import {
  PERMIT_TYPES,
  validateTypeData,
  isPermitType,
  type FieldError,
  type PermitTypeKey,
} from "./registry";
import {
  allApproved,
  checkAction,
  nextStatus,
  type ApprovalLike,
  type PermitAction,
} from "./state";
import {
  auditStatement,
  findConflicts,
  getApprovals,
  getPermit,
  insertApprovalStatements,
  insertPermit,
  nextPermitCode,
  type ApprovalRow,
  type Permit,
} from "./repo";

export type ServiceError = {
  status: number;
  message: string;
  code?: string;
  fieldErrors?: FieldError[];
};

export type Result<T> = { ok: true; data: T } | { ok: false; error: ServiceError };

const isoString = z.string().refine((value) => !Number.isNaN(new Date(value).getTime()), {
  message: "Not a valid date",
});

export const permitInputSchema = z.object({
  type: z.string().refine(isPermitType, { message: "Unknown permit type" }),
  areaId: z.string().min(1, "Area is required"),
  equipmentId: z.string().optional().nullable(),
  contractor: z.string().max(200).optional().nullable(),
  workDescription: z.string().min(12, "Describe the job in at least a dozen characters"),
  locationDetails: z.string().max(300).optional().nullable(),
  plannedStart: isoString,
  plannedEnd: isoString,
  hazards: z.array(z.string()).default([]),
  ppe: z.array(z.string()).default([]),
  precautions: z.array(z.string()).default([]),
  typeData: z.record(z.unknown()).default({}),
});

export type PermitInput = z.infer<typeof permitInputSchema>;

function actorLike(user: SessionUser) {
  return { id: user.id, role: user.role, areaId: user.areaId };
}

function approvalLikes(rows: ApprovalRow[]): ApprovalLike[] {
  return rows.map((row) => ({
    approverRole: row.approver_role,
    approverId: row.approver_id,
    decision: row.decision,
  }));
}

/** Common-field rules that a form can't be trusted to enforce. */
function validateInput(input: PermitInput): FieldError[] {
  const errors: FieldError[] = [];
  const start = new Date(input.plannedStart);
  const end = new Date(input.plannedEnd);

  if (end.getTime() <= start.getTime()) {
    errors.push({ field: "plannedEnd", message: "The end of the window must be after the start." });
  }
  const maxWindow = 12 * 60 * 60 * 1000;
  if (end.getTime() - start.getTime() > maxWindow) {
    errors.push({
      field: "plannedEnd",
      message: "A single permit cannot cover more than 12 hours — that is a shift, not a week.",
    });
  }
  if (!input.hazards.length) {
    errors.push({ field: "hazards", message: "List at least one hazard. 'None' is not a hazard." });
  }
  if (!input.ppe.length) {
    errors.push({ field: "ppe", message: "Select the PPE required for this job." });
  }

  errors.push(
    ...validateTypeData(input.type as PermitTypeKey, input.typeData, { plannedStart: start }),
  );
  return errors;
}

export async function createPermit(
  user: SessionUser,
  input: PermitInput,
  options: { submit: boolean; acknowledgeConflict?: boolean },
): Promise<Result<{ permit: Permit; conflicts: { code: string }[] }>> {
  // Raising and signing are different jobs, held by different people.
  if (user.role !== "REQUESTER" && user.role !== "ADMIN") {
    return {
      ok: false,
      error: {
        status: 403,
        message: "Only a requester can raise a permit. Safety officers and area owners approve them.",
        code: "FORBIDDEN",
      },
    };
  }

  const parsed = permitInputSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: {
        status: 400,
        message: "Some answers are missing or invalid.",
        fieldErrors: parsed.error.issues.map((issue) => ({
          field: issue.path.join("."),
          message: issue.message,
        })),
      },
    };
  }
  const value = parsed.data;

  if (options.submit) {
    const errors = validateInput(value);
    if (errors.length) {
      return { ok: false, error: { status: 422, message: errors[0].message, fieldErrors: errors } };
    }
  }

  const area = await (await db())
    .prepare("SELECT id, plant_id FROM areas WHERE id = ?")
    .bind(value.areaId)
    .first<{ id: string; plant_id: string }>();
  if (!area) return { ok: false, error: { status: 400, message: "Unknown area." } };

  const conflicts = await findConflicts({
    areaId: value.areaId,
    type: value.type as PermitTypeKey,
    plannedStart: value.plannedStart,
    plannedEnd: value.plannedEnd,
  });

  if (options.submit && conflicts.length && !options.acknowledgeConflict) {
    return {
      ok: false,
      error: {
        status: 409,
        code: "CONFLICT",
        message: `${PERMIT_TYPES[value.type as PermitTypeKey].label} overlaps ${conflicts
          .map((conflict) => `${conflict.code} (${PERMIT_TYPES[conflict.type].short})`)
          .join(", ")} in this area.`,
      },
    };
  }

  const code = await nextPermitCode();
  const id = await insertPermit({
    code,
    type: value.type as PermitTypeKey,
    plantId: area.plant_id,
    areaId: value.areaId,
    equipmentId: value.equipmentId || null,
    requesterId: user.id,
    contractor: value.contractor || null,
    workDescription: value.workDescription,
    locationDetails: value.locationDetails || null,
    plannedStart: value.plannedStart,
    plannedEnd: value.plannedEnd,
    hazards: value.hazards,
    ppe: value.ppe,
    precautions: value.precautions,
    typeData: value.typeData,
    status: options.submit ? "PENDING_APPROVAL" : "DRAFT",
    createdAt: nowIso(),
  });

  const handle = await db();
  const createdAt = nowIso();
  const statements = [
    auditStatement(handle, {
      permitId: id,
      actorId: user.id,
      actorLabel: user.name,
      actorRole: user.role,
      action: "create",
      to: options.submit ? "PENDING_APPROVAL" : "DRAFT",
      comment: `Raised ${PERMIT_TYPES[value.type as PermitTypeKey].label} permit ${code}.`,
    }),
  ];

  if (options.submit) {
    statements.push(
      handle
        .prepare("UPDATE permits SET submitted_at = ?, updated_at = ? WHERE id = ?")
        .bind(createdAt, createdAt, id),
      ...insertApprovalStatements(
        handle,
        id,
        PERMIT_TYPES[value.type as PermitTypeKey].approvers,
        createdAt,
      ),
      auditStatement(handle, {
        permitId: id,
        actorId: user.id,
        actorLabel: user.name,
        actorRole: user.role,
        action: "submit",
        from: "DRAFT",
        to: "PENDING_APPROVAL",
        comment: conflicts.length
          ? `Submitted with conflict acknowledged: ${conflicts.map((c) => c.code).join(", ")}.`
          : "Submitted for approval.",
      }),
    );
  }

  await handle.batch(statements);

  const permit = await getPermit(id);
  if (!permit) return { ok: false, error: { status: 500, message: "Permit could not be created." } };
  return { ok: true, data: { permit, conflicts } };
}

export async function submitPermit(
  user: SessionUser,
  permitId: string,
  options: { acknowledgeConflict?: boolean } = {},
): Promise<Result<Permit>> {
  const permit = await getPermit(permitId);
  if (!permit) return { ok: false, error: { status: 404, message: "Permit not found." } };
  const approvals = await getApprovals(permitId);

  const decision = checkAction({
    action: "submit",
    permit: permitLike(permit),
    actor: actorLike(user),
    approvals: approvalLikes(approvals),
  });
  if (!decision.ok) {
    return { ok: false, error: { status: statusFor(decision.code), message: decision.message, code: decision.code } };
  }

  const errors = validateInput({
    type: permit.type,
    areaId: permit.area_id,
    equipmentId: permit.equipment_id,
    contractor: permit.contractor,
    workDescription: permit.work_description,
    locationDetails: permit.location_details,
    plannedStart: permit.planned_start,
    plannedEnd: permit.planned_end,
    hazards: JSON.parse(permit.hazards) as string[],
    ppe: JSON.parse(permit.ppe) as string[],
    precautions: JSON.parse(permit.precautions) as string[],
    typeData: JSON.parse(permit.type_data) as Record<string, unknown>,
  });
  if (errors.length) {
    return { ok: false, error: { status: 422, message: errors[0].message, fieldErrors: errors } };
  }

  const conflicts = await findConflicts({
    permitId,
    areaId: permit.area_id,
    type: permit.type,
    plannedStart: permit.planned_start,
    plannedEnd: permit.planned_end,
  });
  if (conflicts.length && !options.acknowledgeConflict) {
    return {
      ok: false,
      error: {
        status: 409,
        code: "CONFLICT",
        message: `${PERMIT_TYPES[permit.type].label} overlaps ${conflicts
          .map((conflict) => `${conflict.code} (${PERMIT_TYPES[conflict.type].short})`)
          .join(", ")} in ${permit.areaName}.`,
      },
    };
  }

  const handle = await db();
  const at = nowIso();
  await handle.batch([
    handle
      .prepare("UPDATE permits SET status = 'PENDING_APPROVAL', submitted_at = ?, updated_at = ? WHERE id = ?")
      .bind(at, at, permitId),
    ...insertApprovalStatements(handle, permitId, PERMIT_TYPES[permit.type].approvers, at),
    auditStatement(handle, {
      permitId,
      actorId: user.id,
      actorLabel: user.name,
      actorRole: user.role,
      action: "submit",
      from: permit.status,
      to: "PENDING_APPROVAL",
      comment: conflicts.length ? `Conflict acknowledged: ${conflicts.map((c) => c.code).join(", ")}.` : null,
    }),
  ]);

  return { ok: true, data: (await getPermit(permitId))! };
}

export type ActionPayload = {
  action: PermitAction;
  comment?: string;
  notes?: string;
  reason?: string;
  hours?: number;
  signature?: string;
};

export async function actOnPermit(
  user: SessionUser,
  permitId: string,
  payload: ActionPayload,
): Promise<Result<Permit>> {
  const permit = await getPermit(permitId);
  if (!permit) return { ok: false, error: { status: 404, message: "Permit not found." } };

  const approvals = await getApprovals(permitId);
  const likes = approvalLikes(approvals);
  const like = permitLike(permit);

  const decision = checkAction({
    action: payload.action,
    permit: like,
    actor: actorLike(user),
    approvals: likes,
    hours: payload.hours,
  });
  if (!decision.ok) {
    return { ok: false, error: { status: statusFor(decision.code), message: decision.message, code: decision.code } };
  }

  // Actions with required inputs are refused rather than silently recorded.
  if (payload.action === "reject" && !payload.comment?.trim()) {
    return {
      ok: false,
      error: { status: 422, message: "A rejection needs a reason. Say what is missing.", code: "INVALID_INPUT" },
    };
  }
  if (payload.action === "close" && !payload.notes?.trim()) {
    return {
      ok: false,
      error: { status: 422, message: "Record what was actually done before closing the permit.", code: "INVALID_INPUT" },
    };
  }
  if (payload.action === "suspend" && !payload.reason?.trim()) {
    return {
      ok: false,
      error: { status: 422, message: "Say why the permit is being suspended.", code: "INVALID_INPUT" },
    };
  }
  if (payload.action === "verify" && !payload.notes?.trim()) {
    return {
      ok: false,
      error: { status: 422, message: "Verification needs a note about the state of the area.", code: "INVALID_INPUT" },
    };
  }

  const handle = await db();
  const at = nowIso();
  const statements: D1PreparedStatement[] = [];

  switch (payload.action) {
    case "approve":
    case "reject": {
      const role =
        user.role === "ADMIN"
          ? (likes.find((approval) => approval.decision === "PENDING")?.approverRole ?? user.role)
          : user.role;
      const updated = likes.map((approval) =>
        approval.approverRole === role
          ? { ...approval, decision: payload.action === "approve" ? ("APPROVED" as const) : ("REJECTED" as const) }
          : approval,
      );
      const to = nextStatus(payload.action, like, updated);

      statements.push(
        handle
          .prepare(
            `UPDATE approvals SET decision = ?, comment = ?, approver_id = ?, decided_at = ?
              WHERE permit_id = ? AND approver_role = ? AND decision = 'PENDING'`,
          )
          .bind(
            payload.action === "approve" ? "APPROVED" : "REJECTED",
            payload.comment ?? null,
            user.id,
            at,
            permitId,
            role,
          ),
        handle
          .prepare(
            `UPDATE permits SET status = ?, updated_at = ?, approved_at = CASE WHEN ? = 'APPROVED' THEN ? ELSE approved_at END
              WHERE id = ?`,
          )
          .bind(to, at, to, at, permitId),
        auditStatement(handle, {
          permitId,
          actorId: user.id,
          actorLabel: user.name,
          actorRole: role,
          action: payload.action,
          field: "status",
          from: permit.status,
          to,
          comment: payload.comment?.trim() || (payload.action === "approve" ? "Approved." : null),
        }),
      );
      break;
    }

    case "activate":
      statements.push(
        handle
          .prepare("UPDATE permits SET status = 'ACTIVE', active_at = ?, updated_at = ? WHERE id = ?")
          .bind(at, at, permitId),
        auditStatement(handle, {
          permitId,
          actorId: user.id,
          actorLabel: user.name,
          actorRole: user.role,
          action: "activate",
          from: permit.status,
          to: "ACTIVE",
          comment: `Work started inside the window ending ${permit.planned_end}.`,
        }),
      );
      break;

    case "suspend":
      statements.push(
        handle
          .prepare(
            "UPDATE permits SET status = 'SUSPENDED', suspended_at = ?, suspended_reason = ?, updated_at = ? WHERE id = ?",
          )
          .bind(at, payload.reason?.trim() ?? null, at, permitId),
        auditStatement(handle, {
          permitId,
          actorId: user.id,
          actorLabel: user.name,
          actorRole: user.role,
          action: "suspend",
          from: permit.status,
          to: "SUSPENDED",
          comment: payload.reason?.trim() ?? null,
        }),
      );
      break;

    case "resume":
      statements.push(
        handle
          .prepare(
            "UPDATE permits SET status = 'ACTIVE', suspended_at = NULL, suspended_reason = NULL, updated_at = ? WHERE id = ?",
          )
          .bind(at, permitId),
        auditStatement(handle, {
          permitId,
          actorId: user.id,
          actorLabel: user.name,
          actorRole: user.role,
          action: "resume",
          from: permit.status,
          to: "ACTIVE",
          comment: "Work resumed after suspension.",
        }),
      );
      break;

    case "close":
      statements.push(
        handle
          .prepare("UPDATE permits SET status = 'CLOSED', close_notes = ?, closed_at = ?, updated_at = ? WHERE id = ?")
          .bind(payload.notes?.trim() ?? null, at, at, permitId),
        auditStatement(handle, {
          permitId,
          actorId: user.id,
          actorLabel: user.name,
          actorRole: user.role,
          action: "close",
          from: permit.status,
          to: "CLOSED",
          comment: payload.notes?.trim() ?? null,
        }),
      );
      break;

    case "verify":
      statements.push(
        handle
          .prepare(
            "UPDATE permits SET status = 'CLOSED_VERIFIED', verification_notes = ?, updated_at = ? WHERE id = ?",
          )
          .bind(payload.notes?.trim() ?? null, at, permitId),
        auditStatement(handle, {
          permitId,
          actorId: user.id,
          actorLabel: user.name,
          actorRole: user.role,
          action: "verify",
          from: permit.status,
          to: "CLOSED_VERIFIED",
          comment: payload.notes?.trim() ?? null,
        }),
      );
      break;

    case "cancel":
      statements.push(
        handle
          .prepare("UPDATE permits SET status = 'CANCELLED', updated_at = ? WHERE id = ?")
          .bind(at, permitId),
        auditStatement(handle, {
          permitId,
          actorId: user.id,
          actorLabel: user.name,
          actorRole: user.role,
          action: "cancel",
          from: permit.status,
          to: "CANCELLED",
          comment: payload.comment?.trim() || null,
        }),
      );
      break;

    case "request_extension":
      statements.push(
        handle
          .prepare("UPDATE permits SET pending_extension_hours = ?, updated_at = ? WHERE id = ?")
          .bind(payload.hours ?? 0, at, permitId),
        auditStatement(handle, {
          permitId,
          actorId: user.id,
          actorLabel: user.name,
          actorRole: user.role,
          action: "request_extension",
          field: "planned_end",
          from: permit.planned_end,
          to: new Date(new Date(permit.planned_end).getTime() + (payload.hours ?? 0) * 3600_000).toISOString(),
          comment: `Requested ${payload.hours}h extension; waiting on safety officer.`,
        }),
      );
      break;

    case "approve_extension": {
      const hours = permit.pending_extension_hours;
      const newEnd = new Date(new Date(permit.planned_end).getTime() + hours * 3600_000).toISOString();
      statements.push(
        handle
          .prepare(
            `UPDATE permits SET planned_end = ?, extension_hours = extension_hours + ?,
               extension_count = extension_count + 1, pending_extension_hours = 0, updated_at = ?
             WHERE id = ?`,
          )
          .bind(newEnd, hours, at, permitId),
        auditStatement(handle, {
          permitId,
          actorId: user.id,
          actorLabel: user.name,
          actorRole: user.role,
          action: "approve_extension",
          field: "planned_end",
          from: permit.planned_end,
          to: newEnd,
          comment: `Extension of ${hours}h approved (extension ${permit.extension_count + 1}).`,
        }),
      );
      break;
    }

    default:
      return { ok: false, error: { status: 400, message: "Unknown action." } };
  }

  await handle.batch(statements);
  const updated = await getPermit(permitId);
  if (!updated) return { ok: false, error: { status: 500, message: "Permit disappeared." } };
  return { ok: true, data: updated };
}

function permitLike(permit: Permit) {
  return {
    id: permit.id,
    type: permit.type,
    requesterId: permit.requester_id,
    areaId: permit.area_id,
    status: permit.status,
    plannedStart: permit.planned_start,
    plannedEnd: permit.planned_end,
    extensionCount: permit.extension_count,
    pendingExtensionHours: permit.pending_extension_hours,
  };
}

function statusFor(code: string): number {
  switch (code) {
    case "FORBIDDEN":
    case "SELF_APPROVAL":
      return 403;
    case "ILLEGAL_TRANSITION":
    case "ALREADY_DECIDED":
      return 409;
    case "EXPIRED":
    case "NOT_YET_VALID":
      return 409;
    default:
      return 400;
  }
}

export { allApproved };
