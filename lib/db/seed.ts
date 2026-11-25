import { hashPassword } from "../auth";
import { newId } from "./index";
import type { PermitStatus } from "../permits/state";
import type { PermitTypeKey } from "../permits/registry";
import type { Role } from "../auth";

/**
 * Demo data. Idempotent: it only runs when the users table is empty, so a
 * fresh deploy is populated on first request and a live database is never
 * overwritten. Everything is relative to "now" so the dashboard always has an
 * active permit expiring inside the next two hours.
 */

const HOUR = 3_600_000;

export const DEMO_PASSWORD = "permit1234";

type SeedUser = { key: string; name: string; email: string; role: Role; area?: string };

const USERS: SeedUser[] = [
  { key: "ravi", name: "Ravi Kumar", email: "ravi@opmaint.test", role: "REQUESTER" },
  { key: "meena", name: "Meena Sundaram", email: "meena@opmaint.test", role: "AREA_OWNER", area: "asm" },
  { key: "arjun", name: "Arjun Rao", email: "arjun@opmaint.test", role: "SAFETY_OFFICER" },
  { key: "divya", name: "Divya Iyer", email: "divya@opmaint.test", role: "ADMIN" },
];

const PLANTS = [
  { key: "chw", name: "Chennai Works", code: "CHW" },
  { key: "hsr", name: "Hosur Unit", code: "HSR" },
];

const AREAS = [
  { key: "asm", plant: "chw", name: "Assembly Line A", code: "CHW-ASM" },
  { key: "utl", plant: "chw", name: "Utility Block", code: "CHW-UTL" },
  { key: "pnt", plant: "chw", name: "Paint Shop", code: "CHW-PNT" },
  { key: "blr", plant: "hsr", name: "Boiler House", code: "HSR-BLR" },
  { key: "slv", plant: "hsr", name: "Solvent Store", code: "HSR-SLV" },
];

const EQUIPMENT = [
  { key: "press", area: "asm", tag: "PRESS-04", name: "Hydraulic press, 200 T" },
  { key: "tank", area: "utl", tag: "TK-204", name: "Caustic wash tank" },
  { key: "panel", area: "utl", tag: "PCC-1", name: "Main power control centre" },
  { key: "boiler", area: "blr", tag: "BLR-01", name: "Steam boiler 6 T/h" },
  { key: "rack", area: "pnt", tag: "PR-12", name: "Pipe rack, paint shop roof" },
  { key: "comp", area: "slv", tag: "CMP-03", name: "Solvent recovery compressor" },
];

type SeedPermit = {
  type: PermitTypeKey;
  area: string;
  equipment?: string;
  status: PermitStatus;
  startOffsetHours: number;
  endOffsetHours: number;
  description: string;
  contractor?: string;
  location?: string;
  hazards: string[];
  ppe: string[];
  precautions: string[];
  typeData: Record<string, unknown>;
  closeNotes?: string;
  verificationNotes?: string;
  suspendedReason?: string;
  approvalPlan?: "both" | "area_only" | "safety_only" | "rejected";
  rejectionComment?: string;
};

function iso(offsetHours: number): string {
  return new Date(Date.now() + offsetHours * HOUR).toISOString();
}

const PERMITS: SeedPermit[] = [
  {
    type: "HOT_WORK",
    area: "asm",
    equipment: "press",
    status: "ACTIVE",
    startOffsetHours: -2,
    endOffsetHours: 1,
    description: "Weld a mounting bracket onto the press frame after a crack was found at shift start.",
    contractor: "Sakthi Fabrication",
    location: "Line A, bay 3, north side of the press",
    hazards: ["Open flame", "Sparks onto oil residue", "Hot metal"],
    ppe: ["Face shield", "Leather gloves", "FR coverall", "Safety shoes"],
    precautions: ["Fire extinguisher at site", "Fire watch posted", "Combustibles cleared 10 m", "Gas test before start"],
    typeData: {
      hot_work_kind: "Welding",
      fire_watch: "Suresh (contractor supervisor)",
      extinguisher_type: "ABC dry powder",
      combustibles_radius_m: 10,
      gas_lel_percent: 2,
      gas_o2_percent: 20.9,
      gas_test_time: iso(-2.1),
    },
    approvalPlan: "both",
  },
  {
    type: "CONFINED_SPACE",
    area: "utl",
    equipment: "tank",
    status: "PENDING_APPROVAL",
    startOffsetHours: 2,
    endOffsetHours: 10,
    description: "Enter TK-204 to remove scale from the inner wall before the next caustic batch.",
    contractor: "Ravi Kumar",
    location: "Utility block, tank farm, TK-204 manhole",
    hazards: ["Oxygen deficiency", "H2S", "Fall from ladder", "Residual caustic"],
    ppe: ["SCBA on standby", "Chemical suit", "Harness", "Gas monitor"],
    precautions: ["Tank drained and flushed", "Isolation blinds fitted", "Standby attendant posted", "Rescue plan briefed"],
    typeData: {
      space_id: "TK-204",
      entry_point: "Top manhole, north side",
      gas_o2_percent: 20.7,
      gas_lel_percent: 0,
      gas_h2s_ppm: 2,
      gas_co_ppm: 3,
      gas_test_time: iso(1.8),
      standby_attendant: "Karthik S",
      ventilation: "Forced air blower",
      rescue_plan: "Tripod and harness at the manhole; standby attendant calls the shift engineer and never enters. Fire station 4 minutes away.",
      entry_exit_log: "Not started.",
    },
    approvalPlan: "area_only",
  },
  {
    type: "HOT_WORK",
    area: "asm",
    equipment: "press",
    status: "PENDING_APPROVAL",
    startOffsetHours: 5,
    endOffsetHours: 9,
    description: "Grind out porosity on the welded bracket and re-weld one pass.",
    contractor: "Sakthi Fabrication",
    location: "Line A, bay 3",
    hazards: ["Sparks", "Noise", "Hot metal"],
    ppe: ["Face shield", "Leather gloves", "Ear plugs"],
    precautions: ["Fire watch posted", "Extinguisher at site", "Combustibles cleared 8 m"],
    typeData: {
      hot_work_kind: "Grinding",
      fire_watch: "Suresh (contractor supervisor)",
      extinguisher_type: "CO2",
      combustibles_radius_m: 8,
      gas_lel_percent: 0,
      gas_o2_percent: 20.9,
      gas_test_time: iso(4.5),
    },
    approvalPlan: "safety_only",
  },
  {
    type: "LOTO",
    area: "utl",
    equipment: "panel",
    status: "ACTIVE",
    startOffsetHours: -1,
    endOffsetHours: 7,
    description: "Isolate the press feeder from PCC-1 so the control relay can be replaced.",
    location: "Utility block, PCC-1, feeder 14",
    hazards: ["Electric shock", "Arc flash", "Unexpected restart"],
    ppe: ["Arc-rated coverall", "Insulating gloves", "Face shield"],
    precautions: ["Isolation points opened and locked", "Tags fitted", "Tested dead", "Earthing applied"],
    typeData: {
      equipment_tag: "PCC-1 / feeder 14",
      voltage_level: "415 V LV",
      isolation_points: "Incoming breaker 14\nControl fuse 14C\nLocal isolator at PRESS-04",
      lock_numbers: "L-2214, L-2215",
      tag_numbers: "T-881, T-882",
      earthing_applied: true,
      tested_dead_by: "Ravi Kumar",
    },
    approvalPlan: "both",
  },
  {
    type: "WORKING_AT_HEIGHT",
    area: "pnt",
    equipment: "rack",
    status: "APPROVED",
    startOffsetHours: 3,
    endOffsetHours: 8,
    description: "Replace two corroded clamps on the pipe rack above the paint booth roof.",
    contractor: "Anand Scaffolding",
    location: "Paint shop roof, pipe rack PR-12, span 2",
    hazards: ["Fall from height", "Falling objects", "Solvent vapour from booth below"],
    ppe: ["Full body harness", "Helmet with chin strap", "Safety shoes"],
    precautions: ["Scaffold tagged and inspected", "Barricade below", "Anchor point checked", "Tools tethered"],
    typeData: {
      height_m: 6.5,
      access_method: "Scaffold",
      fall_arrest: "Full body harness with twin lanyard to the rack",
      anchor_point_checked: true,
      barricade_below: true,
    },
    approvalPlan: "both",
  },
  {
    type: "HOT_WORK",
    area: "blr",
    equipment: "boiler",
    status: "SUSPENDED",
    startOffsetHours: -3,
    endOffsetHours: 5,
    description: "Cut and replace a section of the boiler feedwater line that has pinhole leaks.",
    contractor: "Sakthi Fabrication",
    location: "Boiler house, feedwater line, downstream of BLR-01",
    hazards: ["Open flame", "Steam", "Hot surface"],
    ppe: ["Face shield", "Heat-resistant gloves", "FR coverall"],
    precautions: ["Line drained and isolated", "Fire watch posted", "Gas test before restart"],
    typeData: {
      hot_work_kind: "Cutting",
      fire_watch: "Mani K",
      extinguisher_type: "DCP",
      combustibles_radius_m: 12,
      gas_lel_percent: 1,
      gas_o2_percent: 20.8,
      gas_test_time: iso(-3.4),
    },
    suspendedReason: "Combustible gas alarm at the boiler house; work stopped and the area was cleared.",
    approvalPlan: "both",
  },
  {
    type: "CONFINED_SPACE",
    area: "slv",
    equipment: "comp",
    status: "REJECTED",
    startOffsetHours: 6,
    endOffsetHours: 12,
    description: "Clean solvent sludge from the recovery compressor sump.",
    location: "Solvent store, sump beneath CMP-03",
    hazards: ["Flammable atmosphere", "Toxic vapour", "Engulfment"],
    ppe: ["SCBA", "Chemical suit"],
    precautions: ["Sump drained", "Ventilation rigged"],
    typeData: {
      space_id: "CMP-03 sump",
      entry_point: "Sump hatch, east side",
      gas_o2_percent: 20.5,
      gas_lel_percent: 18,
      gas_h2s_ppm: 4,
      gas_co_ppm: 6,
      gas_test_time: iso(5.5),
      standby_attendant: "Not assigned",
      ventilation: "Natural draft",
      rescue_plan: "Call the fire station.",
    },
    rejectionComment:
      "18% LEL in a solvent sump is not entry-able. Purge and re-test, name a standby attendant, and give me a rescue plan that does not rely on the fire brigade arriving in time.",
    approvalPlan: "rejected",
  },
  {
    type: "WORKING_AT_HEIGHT",
    area: "blr",
    equipment: "boiler",
    status: "CLOSED",
    startOffsetHours: -6,
    endOffsetHours: -1,
    description: "Clean the boiler stack sampling port from the platform.",
    location: "Boiler house, stack platform, 8 m level",
    hazards: ["Fall from height", "Dust"],
    ppe: ["Harness", "Dust mask", "Goggles"],
    precautions: ["Platform railing checked", "Barricade below", "Harness anchored"],
    typeData: {
      height_m: 8,
      access_method: "Ladder",
      fall_arrest: "Harness with inertia reel to the platform rail",
      anchor_point_checked: true,
      barricade_below: true,
    },
    closeNotes: "Port cleaned, gasket replaced, platform left clear. Ladder removed and returned to the store.",
    approvalPlan: "both",
  },
  {
    type: "HOT_WORK",
    area: "asm",
    equipment: "press",
    status: "CLOSED_VERIFIED",
    startOffsetHours: -30,
    endOffsetHours: -26,
    description: "Weld a guard bracket back onto the press light curtain frame.",
    contractor: "Sakthi Fabrication",
    location: "Line A, bay 3, light curtain frame",
    hazards: ["Sparks", "Hot metal"],
    ppe: ["Face shield", "Leather gloves"],
    precautions: ["Fire watch posted", "Extinguisher at site", "Combustibles cleared 10 m"],
    typeData: {
      hot_work_kind: "Welding",
      fire_watch: "Suresh (contractor supervisor)",
      extinguisher_type: "ABC dry powder",
      combustibles_radius_m: 10,
      gas_lel_percent: 0,
      gas_o2_percent: 20.9,
      gas_test_time: iso(-30.5),
    },
    closeNotes: "Bracket welded, guard refitted, area swept.",
    verificationNotes: "Area clean, no hot spots after 60 minutes, permit signed back in.",
    approvalPlan: "both",
  },
  {
    type: "LOTO",
    area: "pnt",
    status: "EXPIRED",
    startOffsetHours: -8,
    endOffsetHours: -3,
    description: "Isolate the booth extractor fan to replace the bearing.",
    location: "Paint shop, booth 2 extractor",
    hazards: ["Electric shock", "Rotating equipment"],
    ppe: ["Insulating gloves"],
    precautions: ["Isolator locked", "Tag fitted", "Tested dead"],
    typeData: {
      equipment_tag: "EXT-02",
      voltage_level: "415 V LV",
      isolation_points: "Local isolator at EXT-02",
      lock_numbers: "L-2231",
      tag_numbers: "T-905",
      earthing_applied: true,
      tested_dead_by: "Ravi Kumar",
    },
    approvalPlan: "both",
  },
  {
    type: "WORKING_AT_HEIGHT",
    area: "utl",
    status: "DRAFT",
    startOffsetHours: 26,
    endOffsetHours: 32,
    description: "Re-lamp the high bay lights above the utility block walkway.",
    location: "Utility block, walkway, 7 m",
    hazards: ["Fall from height", "Live lighting circuit"],
    ppe: ["Harness", "Helmet"],
    precautions: ["MEWP booked"],
    typeData: {
      height_m: 7,
      access_method: "MEWP",
      fall_arrest: "Harness clipped to the MEWP anchor",
    },
    approvalPlan: "both",
  },
];

function approvalRows(plan: SeedPermit["approvalPlan"]): { role: Role; decision: "PENDING" | "APPROVED" | "REJECTED" }[] {
  switch (plan) {
    case "area_only":
      return [
        { role: "AREA_OWNER", decision: "APPROVED" },
        { role: "SAFETY_OFFICER", decision: "PENDING" },
      ];
    case "safety_only":
      return [
        { role: "AREA_OWNER", decision: "PENDING" },
        { role: "SAFETY_OFFICER", decision: "APPROVED" },
      ];
    case "rejected":
      return [
        { role: "AREA_OWNER", decision: "APPROVED" },
        { role: "SAFETY_OFFICER", decision: "REJECTED" },
      ];
    default:
      return [
        { role: "AREA_OWNER", decision: "APPROVED" },
        { role: "SAFETY_OFFICER", decision: "APPROVED" },
      ];
  }
}

export async function seedIfEmpty(handle: D1Database): Promise<boolean> {
  const existing = await handle.prepare("SELECT COUNT(*) AS count FROM users").first<{ count: number }>();
  if ((existing?.count ?? 0) > 0) return false;

  const now = new Date().toISOString();
  const statements: D1PreparedStatement[] = [];

  const plantIds = new Map<string, string>();
  for (const plant of PLANTS) {
    const id = newId();
    plantIds.set(plant.key, id);
    statements.push(
      handle.prepare("INSERT INTO plants (id, name, code) VALUES (?,?,?)").bind(id, plant.name, plant.code),
    );
  }

  const areaIds = new Map<string, string>();
  for (const area of AREAS) {
    const id = newId();
    areaIds.set(area.key, id);
    statements.push(
      handle
        .prepare("INSERT INTO areas (id, plant_id, name, code) VALUES (?,?,?,?)")
        .bind(id, plantIds.get(area.plant)!, area.name, area.code),
    );
  }

  const equipmentIds = new Map<string, string>();
  for (const item of EQUIPMENT) {
    const id = newId();
    equipmentIds.set(item.key, id);
    statements.push(
      handle
        .prepare("INSERT INTO equipment (id, area_id, tag, name) VALUES (?,?,?,?)")
        .bind(id, areaIds.get(item.area)!, item.tag, item.name),
    );
  }

  const passwordHash = await hashPassword(DEMO_PASSWORD);
  const userIds = new Map<string, string>();
  for (const user of USERS) {
    const id = newId();
    userIds.set(user.key, id);
    statements.push(
      handle
        .prepare(
          `INSERT INTO users (id, email, name, role, password_hash, area_id, plant_id, created_at)
           VALUES (?,?,?,?,?,?,?,?)`,
        )
        .bind(
          id,
          user.email,
          user.name,
          user.role,
          passwordHash,
          user.area ? areaIds.get(user.area)! : null,
          plantIds.get("chw")!,
          now,
        ),
    );
  }

  const requester = userIds.get("ravi")!;
  const areaOwner = userIds.get("meena")!;
  const safetyOfficer = userIds.get("arjun")!;

  PERMITS.forEach((permit, index) => {
    const permitId = newId();
    const code = `PTW-2026-${String(index + 1).padStart(4, "0")}`;
    const areaId = areaIds.get(permit.area)!;
    const plantKey = AREAS.find((area) => area.key === permit.area)!.plant;
    const started = permit.startOffsetHours < 0;
    const createdAt = iso(permit.startOffsetHours - 4);
    const submittedAt = permit.status === "DRAFT" ? null : iso(permit.startOffsetHours - 3.5);
    const approvedAt = ["APPROVED", "ACTIVE", "SUSPENDED", "CLOSED", "CLOSED_VERIFIED"].includes(permit.status)
      ? iso(permit.startOffsetHours - 3)
      : null;

    statements.push(
      handle
        .prepare(
          `INSERT INTO permits (
             id, code, type, plant_id, area_id, equipment_id, requester_id, contractor,
             work_description, location_details, planned_start, planned_end, hazards, ppe,
             precautions, type_data, status, close_notes, verification_notes, suspended_reason,
             created_at, updated_at, submitted_at, approved_at, active_at, suspended_at, closed_at
           ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        )
        .bind(
          permitId,
          code,
          permit.type,
          plantIds.get(plantKey)!,
          areaId,
          permit.equipment ? equipmentIds.get(permit.equipment)! : null,
          requester,
          permit.contractor ?? null,
          permit.description,
          permit.location ?? null,
          iso(permit.startOffsetHours),
          iso(permit.endOffsetHours),
          JSON.stringify(permit.hazards),
          JSON.stringify(permit.ppe),
          JSON.stringify(permit.precautions),
          JSON.stringify(permit.typeData),
          permit.status,
          permit.closeNotes ?? null,
          permit.verificationNotes ?? null,
          permit.suspendedReason ?? null,
          createdAt,
          now,
          submittedAt,
          approvedAt,
          ["ACTIVE", "SUSPENDED", "CLOSED", "CLOSED_VERIFIED"].includes(permit.status)
            ? iso(permit.startOffsetHours)
            : null,
          permit.status === "SUSPENDED" ? iso(permit.startOffsetHours + 0.5) : null,
          ["CLOSED", "CLOSED_VERIFIED"].includes(permit.status) ? iso(permit.endOffsetHours) : null,
        ),
    );

    const audit = (
      action: string,
      actorId: string,
      actorRole: string,
      at: string,
      extra: { from?: string; to?: string; comment?: string; field?: string } = {},
    ) => {
      statements.push(
        handle
          .prepare(
            `INSERT INTO audit_log
               (id, permit_id, actor_id, actor_label, actor_role, action, field, from_value, to_value, comment, created_at)
             VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
          )
          .bind(
            newId(),
            permitId,
            actorId,
            USERS.find((user) => userIds.get(user.key) === actorId)?.name ?? "System",
            actorRole,
            action,
            extra.field ?? null,
            extra.from ?? null,
            extra.to ?? null,
            extra.comment ?? null,
            at,
          ),
      );
    };

    audit("create", requester, "REQUESTER", createdAt, { to: "DRAFT", comment: `Raised permit ${code}.` });

    if (permit.status !== "DRAFT") {
      audit("submit", requester, "REQUESTER", submittedAt!, {
        from: "DRAFT",
        to: "PENDING_APPROVAL",
        comment: "Submitted for approval.",
      });

      const plan = approvalRows(permit.approvalPlan);
      const decisions: Record<Role, string> = {
        AREA_OWNER: plan.find((row) => row.role === "AREA_OWNER")?.decision ?? "PENDING",
        SAFETY_OFFICER: plan.find((row) => row.role === "SAFETY_OFFICER")?.decision ?? "PENDING",
        REQUESTER: "PENDING",
        ADMIN: "PENDING",
      };

      for (const role of ["AREA_OWNER", "SAFETY_OFFICER"] as Role[]) {
        const decision = decisions[role] as "PENDING" | "APPROVED" | "REJECTED";
        const approverId = role === "AREA_OWNER" ? areaOwner : safetyOfficer;
        const decidedAt = decision === "PENDING" ? null : iso(permit.startOffsetHours - 3);
        const approveComment =
          role === "AREA_OWNER"
            ? "Machine locked off and the area cleared for the contractor."
            : "Gas test verified on site; fire watch briefed, extinguisher in place.";

        statements.push(
          handle
            .prepare(
              `INSERT INTO approvals (id, permit_id, approver_role, approver_id, decision, comment, decided_at, created_at)
               VALUES (?,?,?,?,?,?,?,?)`,
            )
            .bind(
              newId(),
              permitId,
              role,
              decision === "PENDING" ? null : approverId,
              decision,
              decision === "REJECTED"
                ? permit.rejectionComment ?? "Rejected."
                : decision === "APPROVED"
                  ? approveComment
                  : null,
              decidedAt,
              submittedAt!,
            ),
        );

        if (decision !== "PENDING") {
          audit(decision === "APPROVED" ? "approve" : "reject", approverId, role, decidedAt!, {
            from: "PENDING_APPROVAL",
            to: decision === "APPROVED" ? "PENDING_APPROVAL" : "REJECTED",
            comment: decision === "REJECTED" ? permit.rejectionComment : approveComment,
          });
        }
      }

      if (approvedAt) {
        audit("approve", safetyOfficer, "SAFETY_OFFICER", approvedAt, {
          from: "PENDING_APPROVAL",
          to: "APPROVED",
          comment: "All approvers signed.",
        });
      }
      if (["ACTIVE", "SUSPENDED", "CLOSED", "CLOSED_VERIFIED"].includes(permit.status)) {
        audit("activate", requester, "REQUESTER", iso(permit.startOffsetHours), {
          from: "APPROVED",
          to: "ACTIVE",
          comment: "Work started.",
        });
      }
      if (permit.status === "SUSPENDED") {
        audit("suspend", safetyOfficer, "SAFETY_OFFICER", iso(permit.startOffsetHours + 0.5), {
          from: "ACTIVE",
          to: "SUSPENDED",
          comment: permit.suspendedReason,
        });
      }
      if (permit.status === "EXPIRED") {
        audit("expire", safetyOfficer, "SYSTEM", iso(permit.endOffsetHours), {
          from: "ACTIVE",
          to: "EXPIRED",
          comment: "Validity window ended.",
        });
      }
      if (["CLOSED", "CLOSED_VERIFIED"].includes(permit.status)) {
        audit("close", requester, "REQUESTER", iso(permit.endOffsetHours), {
          from: "ACTIVE",
          to: "CLOSED",
          comment: permit.closeNotes,
        });
      }
      if (permit.status === "CLOSED_VERIFIED") {
        audit("verify", safetyOfficer, "SAFETY_OFFICER", iso(permit.endOffsetHours + 0.5), {
          from: "CLOSED",
          to: "CLOSED_VERIFIED",
          comment: permit.verificationNotes,
        });
      }
      void started;
    }
  });

  await handle.batch(statements);
  return true;
}
