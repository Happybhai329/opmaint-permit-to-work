import { describe, expect, it } from "vitest";
import {
  availableActions,
  checkAction,
  isWindowExpired,
  nextStatus,
  shouldAutoExpire,
  type ApprovalLike,
  type PermitLike,
} from "@/lib/permits/state";

const HOUR = 3_600_000;

function permit(overrides: Partial<PermitLike> = {}): PermitLike {
  return {
    id: "p1",
    type: "HOT_WORK",
    requesterId: "ravi",
    areaId: "asm",
    status: "DRAFT",
    plannedStart: new Date(Date.now() + HOUR).toISOString(),
    plannedEnd: new Date(Date.now() + 8 * HOUR).toISOString(),
    extensionCount: 0,
    pendingExtensionHours: 0,
    ...overrides,
  };
}

function approvals(...decisions: ("PENDING" | "APPROVED" | "REJECTED")[]): ApprovalLike[] {
  return decisions.map((decision, index) => ({
    approverRole: index === 0 ? "AREA_OWNER" : "SAFETY_OFFICER",
    approverId: decision === "PENDING" ? null : `approver-${index}`,
    decision,
  }));
}

const ravi = { id: "ravi", role: "REQUESTER" as const, areaId: null };
const meena = { id: "meena", role: "AREA_OWNER" as const, areaId: "asm" };
const arjun = { id: "arjun", role: "SAFETY_OFFICER" as const, areaId: null };
const divya = { id: "divya", role: "ADMIN" as const, areaId: null };

describe("submit", () => {
  it("lets the requester submit a draft", () => {
    const result = checkAction({ action: "submit", permit: permit(), actor: ravi, approvals: [] });
    expect(result.ok).toBe(true);
  });

  it("refuses a submit from someone else", () => {
    const result = checkAction({ action: "submit", permit: permit(), actor: arjun, approvals: [] });
    expect(result).toMatchObject({ ok: false, code: "FORBIDDEN" });
  });

  it("refuses submitting an already submitted permit", () => {
    const result = checkAction({
      action: "submit",
      permit: permit({ status: "PENDING_APPROVAL" }),
      actor: ravi,
      approvals: approvals("PENDING", "PENDING"),
    });
    expect(result).toMatchObject({ ok: false, code: "ILLEGAL_TRANSITION" });
  });
});

describe("approval", () => {
  it("lets the area owner approve a permit in their own area", () => {
    const result = checkAction({
      action: "approve",
      permit: permit({ status: "PENDING_APPROVAL" }),
      actor: meena,
      approvals: approvals("PENDING", "PENDING"),
    });
    expect(result.ok).toBe(true);
  });

  it("refuses an area owner approving work in another area", () => {
    const result = checkAction({
      action: "approve",
      permit: permit({ status: "PENDING_APPROVAL", areaId: "utl" }),
      actor: meena,
      approvals: approvals("PENDING", "PENDING"),
    });
    expect(result).toMatchObject({ ok: false, code: "FORBIDDEN" });
  });

  it("never lets a person approve their own permit, whatever their role", () => {
    const safetyOwned = permit({ status: "PENDING_APPROVAL", requesterId: arjun.id });
    const result = checkAction({
      action: "approve",
      permit: safetyOwned,
      actor: arjun,
      approvals: approvals("APPROVED", "PENDING"),
    });
    expect(result).toMatchObject({ ok: false, code: "SELF_APPROVAL" });
  });

  it("refuses the requester approving at all, even with an approver role", () => {
    const result = checkAction({
      action: "approve",
      permit: permit({ status: "PENDING_APPROVAL" }),
      actor: { ...ravi, role: "AREA_OWNER", areaId: "asm" },
      approvals: approvals("PENDING", "PENDING"),
    });
    expect(result).toMatchObject({ ok: false, code: "SELF_APPROVAL" });
  });

  it("refuses a second decision from the same approver", () => {
    const result = checkAction({
      action: "approve",
      permit: permit({ status: "PENDING_APPROVAL" }),
      actor: meena,
      approvals: approvals("APPROVED", "PENDING"),
    });
    expect(result).toMatchObject({ ok: false, code: "ALREADY_DECIDED" });
  });

  it("keeps the permit pending until the last signature lands", () => {
    expect(nextStatus("approve", permit({ status: "PENDING_APPROVAL" }), approvals("APPROVED", "PENDING"))).toBe(
      "PENDING_APPROVAL",
    );
    expect(nextStatus("approve", permit({ status: "PENDING_APPROVAL" }), approvals("APPROVED", "APPROVED"))).toBe(
      "APPROVED",
    );
  });

  it("moves to REJECTED on a rejection", () => {
    expect(nextStatus("reject", permit({ status: "PENDING_APPROVAL" }), approvals("PENDING", "REJECTED"))).toBe(
      "REJECTED",
    );
  });
});

describe("activation", () => {
  it("refuses to start without every approval", () => {
    const result = checkAction({
      action: "activate",
      permit: permit({ status: "APPROVED" }),
      actor: ravi,
      approvals: approvals("APPROVED", "PENDING"),
    });
    expect(result).toMatchObject({ ok: false, code: "APPROVALS_INCOMPLETE" });
  });

  it("refuses to start before the planned window opens", () => {
    const result = checkAction({
      action: "activate",
      permit: permit({
        status: "APPROVED",
        plannedStart: new Date(Date.now() + 2 * HOUR).toISOString(),
      }),
      actor: ravi,
      approvals: approvals("APPROVED", "APPROVED"),
    });
    expect(result).toMatchObject({ ok: false, code: "NOT_YET_VALID" });
  });

  it("refuses to start after the window has closed", () => {
    const result = checkAction({
      action: "activate",
      permit: permit({
        status: "APPROVED",
        plannedStart: new Date(Date.now() - 6 * HOUR).toISOString(),
        plannedEnd: new Date(Date.now() - HOUR).toISOString(),
      }),
      actor: ravi,
      approvals: approvals("APPROVED", "APPROVED"),
    });
    expect(result).toMatchObject({ ok: false, code: "EXPIRED" });
  });

  it("starts an approved permit inside its window", () => {
    const result = checkAction({
      action: "activate",
      permit: permit({
        status: "APPROVED",
        plannedStart: new Date(Date.now() - HOUR).toISOString(),
      }),
      actor: ravi,
      approvals: approvals("APPROVED", "APPROVED"),
    });
    expect(result.ok).toBe(true);
  });
});

describe("suspension", () => {
  it("lets the safety officer stop work instantly", () => {
    const result = checkAction({
      action: "suspend",
      permit: permit({ status: "ACTIVE" }),
      actor: arjun,
      approvals: approvals("APPROVED", "APPROVED"),
    });
    expect(result.ok).toBe(true);
  });

  it("refuses the requester suspending their own permit", () => {
    const result = checkAction({
      action: "suspend",
      permit: permit({ status: "ACTIVE" }),
      actor: ravi,
      approvals: approvals("APPROVED", "APPROVED"),
    });
    expect(result).toMatchObject({ ok: false, code: "FORBIDDEN" });
  });

  it("will not resume a permit whose window passed while suspended", () => {
    const result = checkAction({
      action: "resume",
      permit: permit({
        status: "SUSPENDED",
        plannedStart: new Date(Date.now() - 9 * HOUR).toISOString(),
        plannedEnd: new Date(Date.now() - HOUR).toISOString(),
      }),
      actor: arjun,
      approvals: approvals("APPROVED", "APPROVED"),
    });
    expect(result).toMatchObject({ ok: false, code: "EXPIRED" });
  });
});

describe("closure", () => {
  it("lets the requester mark work complete, then the safety officer verify", () => {
    const closed = checkAction({
      action: "close",
      permit: permit({ status: "ACTIVE" }),
      actor: ravi,
      approvals: approvals("APPROVED", "APPROVED"),
    });
    expect(closed.ok).toBe(true);

    const verified = checkAction({
      action: "verify",
      permit: permit({ status: "CLOSED" }),
      actor: arjun,
      approvals: approvals("APPROVED", "APPROVED"),
    });
    expect(verified.ok).toBe(true);
  });

  it("refuses verification by the requester", () => {
    const result = checkAction({
      action: "verify",
      permit: permit({ status: "CLOSED" }),
      actor: ravi,
      approvals: approvals("APPROVED", "APPROVED"),
    });
    expect(result).toMatchObject({ ok: false, code: "FORBIDDEN" });
  });

  it("refuses a safety officer closing work they did not do", () => {
    const result = checkAction({
      action: "close",
      permit: permit({ status: "ACTIVE" }),
      actor: arjun,
      approvals: approvals("APPROVED", "APPROVED"),
    });
    expect(result).toMatchObject({ ok: false, code: "FORBIDDEN" });
  });
});

describe("terminal states", () => {
  it.each(["REJECTED", "EXPIRED", "CLOSED_VERIFIED", "CANCELLED"] as const)(
    "refuses every action on a %s permit",
    (status) => {
      const actions = availableActions(permit({ status }), divya, approvals("APPROVED", "APPROVED"));
      expect(actions).toEqual([]);
    },
  );

  it("expires anything past its window that is not closed", () => {
    const past = {
      plannedStart: new Date(Date.now() - 6 * HOUR).toISOString(),
      plannedEnd: new Date(Date.now() - HOUR).toISOString(),
    };
    expect(shouldAutoExpire(permit({ status: "ACTIVE", ...past }))).toBe(true);
    expect(shouldAutoExpire(permit({ status: "APPROVED", ...past }))).toBe(true);
    expect(shouldAutoExpire(permit({ status: "CLOSED_VERIFIED", ...past }))).toBe(false);
    expect(isWindowExpired(past.plannedEnd)).toBe(true);
  });
});

describe("extensions", () => {
  it("caps an extension request at four hours and two grants", () => {
    const active = permit({ status: "ACTIVE", plannedStart: new Date(Date.now() - HOUR).toISOString() });
    expect(
      checkAction({ action: "request_extension", permit: active, actor: ravi, approvals: [], hours: 5 }),
    ).toMatchObject({ ok: false, code: "INVALID_INPUT" });

    expect(
      checkAction({
        action: "request_extension",
        permit: permit({ ...active, extensionCount: 2 }),
        actor: ravi,
        approvals: [],
        hours: 2,
      }),
    ).toMatchObject({ ok: false, code: "ILLEGAL_TRANSITION" });
  });

  it("needs a safety officer to grant an extension", () => {
    const pending = permit({
      status: "ACTIVE",
      plannedStart: new Date(Date.now() - HOUR).toISOString(),
      pendingExtensionHours: 2,
    });
    expect(checkAction({ action: "approve_extension", permit: pending, actor: ravi, approvals: [] })).toMatchObject({
      ok: false,
      code: "FORBIDDEN",
    });
    expect(
      checkAction({ action: "approve_extension", permit: pending, actor: arjun, approvals: [] }).ok,
    ).toBe(true);
  });

  it("refuses an extension once the window has already closed", () => {
    const result = checkAction({
      action: "request_extension",
      permit: permit({
        status: "ACTIVE",
        plannedStart: new Date(Date.now() - 9 * HOUR).toISOString(),
        plannedEnd: new Date(Date.now() - HOUR).toISOString(),
      }),
      actor: ravi,
      approvals: [],
      hours: 2,
    });
    expect(result).toMatchObject({ ok: false, code: "EXPIRED" });
  });
});

describe("availableActions", () => {
  it("only offers what the machine would accept", () => {
    const draft = availableActions(permit(), ravi, []);
    expect(draft).toContain("submit");
    expect(draft).toContain("cancel");
    expect(draft).not.toContain("approve");
    expect(draft).not.toContain("activate");

    const pendingForMeena = availableActions(permit({ status: "PENDING_APPROVAL" }), meena, approvals("PENDING", "PENDING"));
    expect(pendingForMeena).toContain("approve");
    expect(pendingForMeena).toContain("reject");
    expect(pendingForMeena).not.toContain("submit");
  });

  it("shows a requester no approve button on their own permit", () => {
    const actions = availableActions(
      permit({ status: "PENDING_APPROVAL" }),
      { ...ravi, role: "REQUETER" as never },
      approvals("PENDING", "PENDING"),
    );
    expect(actions).not.toContain("approve");
  });
});
