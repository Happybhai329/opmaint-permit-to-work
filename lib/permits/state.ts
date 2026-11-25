import type { Role } from "../auth";
import { PERMIT_TYPES, type PermitTypeKey } from "./registry";

/**
 * The permit state machine, as a pure module.
 *
 * Every rule here is enforced again in the API route and, where possible, by
 * the database; this module is the single source of truth that both the UI and
 * the API call. Nothing in the UI is trusted: a direct POST with an illegal
 * transition gets the same answer as a missing button.
 */

export const STATUSES = [
  "DRAFT",
  "PENDING_APPROVAL",
  "APPROVED",
  "ACTIVE",
  "SUSPENDED",
  "REJECTED",
  "EXPIRED",
  "CLOSED",
  "CLOSED_VERIFIED",
  "CANCELLED",
] as const;

export type PermitStatus = (typeof STATUSES)[number];

export const STATUS_LABELS: Record<PermitStatus, string> = {
  DRAFT: "Draft",
  PENDING_APPROVAL: "Pending approval",
  APPROVED: "Approved",
  ACTIVE: "Active",
  SUSPENDED: "Suspended",
  REJECTED: "Rejected",
  EXPIRED: "Expired",
  CLOSED: "Closed — awaiting verification",
  CLOSED_VERIFIED: "Closed & verified",
  CANCELLED: "Cancelled",
};

export const STATUS_TONE: Record<PermitStatus, "neutral" | "info" | "warn" | "danger" | "ok"> = {
  DRAFT: "neutral",
  PENDING_APPROVAL: "warn",
  APPROVED: "info",
  ACTIVE: "ok",
  SUSPENDED: "danger",
  REJECTED: "danger",
  EXPIRED: "neutral",
  CLOSED: "info",
  CLOSED_VERIFIED: "neutral",
  CANCELLED: "neutral",
};

export const TERMINAL_STATUSES: PermitStatus[] = [
  "REJECTED",
  "EXPIRED",
  "CLOSED_VERIFIED",
  "CANCELLED",
];

export type PermitAction =
  | "submit"
  | "approve"
  | "reject"
  | "activate"
  | "suspend"
  | "resume"
  | "close"
  | "verify"
  | "cancel"
  | "request_extension"
  | "approve_extension";

export type PermitLike = {
  id: string;
  type: PermitTypeKey;
  requesterId: string;
  areaId: string;
  status: PermitStatus;
  plannedStart: string;
  plannedEnd: string;
  extensionCount: number;
  pendingExtensionHours: number;
};

export type ApprovalLike = {
  approverRole: Role;
  approverId: string | null;
  decision: "PENDING" | "APPROVED" | "REJECTED";
};

export type ActorLike = { id: string; role: Role; areaId: string | null };

export type Decision =
  | { ok: true }
  | {
      ok: false;
      code:
        | "ILLEGAL_TRANSITION"
        | "FORBIDDEN"
        | "NOT_YET_VALID"
        | "EXPIRED"
        | "SELF_APPROVAL"
        | "ALREADY_DECIDED"
        | "APPROVALS_INCOMPLETE"
        | "INVALID_INPUT";
      message: string;
    };

export const ACTION_LABELS: Record<PermitAction, string> = {
  submit: "Submit for approval",
  approve: "Approve",
  reject: "Reject",
  activate: "Start work",
  suspend: "Suspend",
  resume: "Resume",
  close: "Mark work complete",
  verify: "Verify & close out",
  cancel: "Cancel permit",
  request_extension: "Request extension",
  approve_extension: "Approve extension",
};

const ACTION_SOURCE: Record<PermitAction, PermitStatus[]> = {
  submit: ["DRAFT"],
  approve: ["PENDING_APPROVAL"],
  reject: ["PENDING_APPROVAL"],
  activate: ["APPROVED"],
  suspend: ["ACTIVE"],
  resume: ["SUSPENDED"],
  close: ["ACTIVE"],
  verify: ["CLOSED"],
  cancel: ["DRAFT", "PENDING_APPROVAL", "APPROVED", "ACTIVE", "SUSPENDED", "CLOSED"],
  request_extension: ["ACTIVE"],
  approve_extension: ["ACTIVE"],
};

const MAX_EXTENSION_HOURS = 4;
const MAX_EXTENSIONS = 2;

export function isTerminal(status: PermitStatus): boolean {
  return TERMINAL_STATUSES.includes(status);
}

/** A permit whose validity window has passed can never come back to life. */
export function isWindowExpired(plannedEnd: string, now = new Date()): boolean {
  return new Date(plannedEnd).getTime() <= now.getTime();
}

export function shouldAutoExpire(permit: PermitLike, now = new Date()): boolean {
  if (!["ACTIVE", "SUSPENDED", "APPROVED", "PENDING_APPROVAL"].includes(permit.status)) return false;
  return isWindowExpired(permit.plannedEnd, now);
}

function hasRole(actor: ActorLike, ...roles: Role[]): boolean {
  return roles.includes(actor.role);
}

function isOwn(actor: ActorLike, permit: PermitLike): boolean {
  return permit.requesterId === actor.id;
}

/** Area owners are scoped to their own area; safety and admin are plant-wide. */
export function approvesInArea(actor: ActorLike, permit: PermitLike): boolean {
  if (actor.role === "AREA_OWNER") return actor.areaId === permit.areaId;
  return true;
}

export function pendingApprovals(approvals: ApprovalLike[]): ApprovalLike[] {
  return approvals.filter((approval) => approval.decision === "PENDING");
}

export function allApproved(approvals: ApprovalLike[]): boolean {
  return approvals.length > 0 && approvals.every((approval) => approval.decision === "APPROVED");
}

/**
 * The one gate every state change passes through.
 * `hours` is only read by request_extension.
 */
export function checkAction(input: {
  action: PermitAction;
  permit: PermitLike;
  actor: ActorLike;
  approvals: ApprovalLike[];
  now?: Date;
  hours?: number;
}): Decision {
  const { action, permit, actor, approvals, hours } = input;
  const now = input.now ?? new Date();

  if (!ACTION_SOURCE[action].includes(permit.status)) {
    return {
      ok: false,
      code: "ILLEGAL_TRANSITION",
      message: `Cannot ${ACTION_LABELS[action].toLowerCase()} a permit that is ${STATUS_LABELS[permit.status].toLowerCase()}.`,
    };
  }

  if (isTerminal(permit.status)) {
    return {
      ok: false,
      code: "ILLEGAL_TRANSITION",
      message: "This permit is closed out and cannot be changed. Raise a new permit.",
    };
  }

  switch (action) {
    case "submit": {
      if (!isOwn(actor, permit) && actor.role !== "ADMIN") {
        return { ok: false, code: "FORBIDDEN", message: "Only the requester can submit this permit." };
      }
      return { ok: true };
    }

    case "approve":
    case "reject": {
      if (isOwn(actor, permit)) {
        return {
          ok: false,
          code: "SELF_APPROVAL",
          message: "You cannot approve or reject a permit you raised.",
        };
      }
      const mine = approvals.find((approval) => approval.approverRole === actor.role);
      const delegated = actor.role === "ADMIN" ? pendingApprovals(approvals)[0] : mine;
      if (!delegated) {
        return {
          ok: false,
          code: "FORBIDDEN",
          message: `A ${actor.role.replace("_", " ").toLowerCase()} approval is not required on this permit.`,
        };
      }
      if (delegated.decision !== "PENDING") {
        return {
          ok: false,
          code: "ALREADY_DECIDED",
          message: "You already recorded a decision on this permit.",
        };
      }
      if (!approvesInArea(actor, permit)) {
        return {
          ok: false,
          code: "FORBIDDEN",
          message: "You can only approve permits for equipment in your own area.",
        };
      }
      if (action === "approve" && isWindowExpired(permit.plannedEnd, now)) {
        return {
          ok: false,
          code: "EXPIRED",
          message: "The validity window has already passed. Reject it and ask for a new permit.",
        };
      }
      return { ok: true };
    }

    case "activate": {
      if (!isOwn(actor, permit) && !hasRole(actor, "ADMIN", "SAFETY_OFFICER")) {
        return { ok: false, code: "FORBIDDEN", message: "Only the requester can start this work." };
      }
      if (!allApproved(approvals)) {
        return {
          ok: false,
          code: "APPROVALS_INCOMPLETE",
          message: "Every required approver must sign before work can start.",
        };
      }
      if (now.getTime() < new Date(permit.plannedStart).getTime()) {
        return {
          ok: false,
          code: "NOT_YET_VALID",
          message: "This permit cannot be activated before its planned start time.",
        };
      }
      if (isWindowExpired(permit.plannedEnd, now)) {
        return {
          ok: false,
          code: "EXPIRED",
          message: "The planned window has passed. Raise a new permit.",
        };
      }
      return { ok: true };
    }

    case "suspend":
    case "resume": {
      if (!hasRole(actor, "SAFETY_OFFICER", "ADMIN")) {
        return {
          ok: false,
          code: "FORBIDDEN",
          message: "Only a safety officer can suspend or resume a permit.",
        };
      }
      if (action === "resume" && isWindowExpired(permit.plannedEnd, now)) {
        return {
          ok: false,
          code: "EXPIRED",
          message: "The window has passed while suspended — this permit cannot resume.",
        };
      }
      return { ok: true };
    }

    case "close": {
      if (!isOwn(actor, permit) && actor.role !== "ADMIN") {
        return {
          ok: false,
          code: "FORBIDDEN",
          message: "Only the requester can mark their own work complete.",
        };
      }
      return { ok: true };
    }

    case "verify": {
      if (!hasRole(actor, "SAFETY_OFFICER", "ADMIN")) {
        return {
          ok: false,
          code: "FORBIDDEN",
          message: "Closure verification is done by the safety officer.",
        };
      }
      return { ok: true };
    }

    case "cancel": {
      if (hasRole(actor, "SAFETY_OFFICER", "ADMIN")) return { ok: true };
      if (isOwn(actor, permit) && ["DRAFT", "PENDING_APPROVAL", "APPROVED"].includes(permit.status)) {
        return { ok: true };
      }
      return {
        ok: false,
        code: "FORBIDDEN",
        message: "Work that has already started can only be cancelled by a safety officer.",
      };
    }

    case "request_extension": {
      if (!isOwn(actor, permit) && actor.role !== "ADMIN") {
        return { ok: false, code: "FORBIDDEN", message: "Only the requester can ask for an extension." };
      }
      if (permit.pendingExtensionHours > 0) {
        return {
          ok: false,
          code: "ILLEGAL_TRANSITION",
          message: "An extension request is already waiting for the safety officer.",
        };
      }
      if (permit.extensionCount >= MAX_EXTENSIONS) {
        return {
          ok: false,
          code: "ILLEGAL_TRANSITION",
          message: `An extension has already been granted ${MAX_EXTENSIONS} times. Raise a new permit.`,
        };
      }
      if (isWindowExpired(permit.plannedEnd, now)) {
        return {
          ok: false,
          code: "EXPIRED",
          message: "The permit has already expired — extensions must be requested before the window ends.",
        };
      }
      if (!hours || hours < 1 || hours > MAX_EXTENSION_HOURS) {
        return {
          ok: false,
          code: "INVALID_INPUT",
          message: `Ask for between 1 and ${MAX_EXTENSION_HOURS} hours.`,
        };
      }
      return { ok: true };
    }

    case "approve_extension": {
      if (!hasRole(actor, "SAFETY_OFFICER", "ADMIN")) {
        return {
          ok: false,
          code: "FORBIDDEN",
          message: "Only a safety officer can grant an extension.",
        };
      }
      if (permit.pendingExtensionHours <= 0) {
        return {
          ok: false,
          code: "ILLEGAL_TRANSITION",
          message: "There is no extension request waiting.",
        };
      }
      return { ok: true };
    }

    default:
      return { ok: false, code: "INVALID_INPUT", message: "Unknown action." };
  }
}

/** Where the permit lands if the action succeeds. */
export function nextStatus(
  action: PermitAction,
  permit: PermitLike,
  approvals: ApprovalLike[],
): PermitStatus {
  switch (action) {
    case "submit":
      return "PENDING_APPROVAL";
    case "approve":
      // `approvals` here is the list *after* this decision was applied, so a
      // permit becomes APPROVED only when the last signature lands.
      return allApproved(approvals) ? "APPROVED" : "PENDING_APPROVAL";
    case "reject":
      return "REJECTED";
    case "activate":
      return "ACTIVE";
    case "suspend":
      return "SUSPENDED";
    case "resume":
      return "ACTIVE";
    case "close":
      return "CLOSED";
    case "verify":
      return "CLOSED_VERIFIED";
    case "cancel":
      return "CANCELLED";
    default:
      return permit.status;
  }
}

/**
 * Actions to show a user. Deliberately returns only what checkAction would
 * accept, so the UI can never render a button the API would refuse.
 */
export function availableActions(
  permit: PermitLike,
  actor: ActorLike,
  approvals: ApprovalLike[],
  now = new Date(),
): PermitAction[] {
  return (Object.keys(ACTION_LABELS) as PermitAction[]).filter((action) =>
    checkAction({ action, permit, actor, approvals, now, hours: 1 }).ok,
  );
}

export function requiredApprovers(type: PermitTypeKey): Role[] {
  return PERMIT_TYPES[type].approvers;
}

export const EXTENSION_LIMITS = { maxHours: MAX_EXTENSION_HOURS, maxCount: MAX_EXTENSIONS };
