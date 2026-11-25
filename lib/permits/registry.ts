import type { Role } from "../auth";

/**
 * Permit type registry.
 *
 * Every permit type is the *same* entity (permit + approvals + audit) plus a
 * declared set of fields and rules. The create form, the detail view and the
 * server-side validator are all driven from these definitions, so adding a
 * fifth type (Excavation) is one object in this file — no new table, no copied
 * form, no new endpoint.
 */

export type PermitTypeKey =
  | "HOT_WORK"
  | "CONFINED_SPACE"
  | "WORKING_AT_HEIGHT"
  | "LOTO"
  | "EXCAVATION";

export type FieldKind =
  | "text"
  | "textarea"
  | "number"
  | "select"
  | "datetime"
  | "checkbox";

export type FieldDef = {
  key: string;
  label: string;
  kind: FieldKind;
  required?: boolean;
  options?: string[];
  unit?: string;
  min?: number;
  max?: number;
  help?: string;
  group?: "job" | "safety" | "gas";
};

export type PermitTypeDef = {
  key: PermitTypeKey;
  label: string;
  short: string;
  /** One line of "why this form exists" — shown on the type picker. */
  summary: string;
  /** Roles that must approve before the permit can go ACTIVE. */
  approvers: Role[];
  defaultValidityHours: number;
  /** Types that must not overlap this one in the same area. */
  conflictsWith: PermitTypeKey[];
  fields: FieldDef[];
  /** Cross-field rules that a per-field check can't express. */
  crossCheck?: (data: Record<string, unknown>, ctx: CrossCheckContext) => string[];
};

export type CrossCheckContext = { plannedStart: Date };

const GAS_LIMITS = {
  o2Min: 19.5,
  o2Max: 23.5,
  lelMax: 10,
  h2sMax: 10,
  coMax: 35,
};

function num(value: unknown): number | null {
  if (value === "" || value === null || value === undefined) return null;
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function str(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

/** Gas tests are only evidence if they are recent. 60 minutes is the normal rule. */
function gasTestProblems(data: Record<string, unknown>, ctx: CrossCheckContext): string[] {
  const problems: string[] = [];
  const testedAt = str(data.gas_test_time);
  if (testedAt) {
    const tested = new Date(testedAt);
    const minutes = (ctx.plannedStart.getTime() - tested.getTime()) / 60000;
    if (Number.isNaN(tested.getTime())) {
      problems.push("Gas test time is not a valid date.");
    } else if (minutes > 60) {
      problems.push("Gas test must be taken within 60 minutes of the planned start.");
    } else if (minutes < -5) {
      problems.push("Gas test time cannot be in the future relative to the planned start.");
    }
  }

  const o2 = num(data.gas_o2_percent);
  if (o2 !== null && (o2 < GAS_LIMITS.o2Min || o2 > GAS_LIMITS.o2Max)) {
    problems.push(`Oxygen must read ${GAS_LIMITS.o2Min}–${GAS_LIMITS.o2Max}% (got ${o2}%).`);
  }
  const lel = num(data.gas_lel_percent);
  if (lel !== null && lel > GAS_LIMITS.lelMax) {
    problems.push(
      `Flammable gas is ${lel}% LEL. Work cannot be authorised above ${GAS_LIMITS.lelMax}% LEL.`,
    );
  }
  return problems;
}

export const PERMIT_TYPES: Record<PermitTypeKey, PermitTypeDef> = {
  HOT_WORK: {
    key: "HOT_WORK",
    label: "Hot Work",
    short: "Hot work",
    summary: "Welding, grinding, cutting or soldering — anything that can ignite vapour.",
    approvers: ["AREA_OWNER", "SAFETY_OFFICER"],
    defaultValidityHours: 8,
    conflictsWith: ["CONFINED_SPACE"],
    fields: [
      {
        key: "hot_work_kind",
        label: "Type of hot work",
        kind: "select",
        options: ["Welding", "Grinding", "Cutting", "Soldering"],
        required: true,
        group: "job",
      },
      {
        key: "fire_watch",
        label: "Fire watch assigned",
        kind: "text",
        required: true,
        group: "safety",
        help: "Name of the person dedicated to watching for fire for the whole job.",
      },
      {
        key: "extinguisher_type",
        label: "Fire extinguisher present",
        kind: "select",
        options: ["CO2", "ABC dry powder", "DCP", "Foam", "Water"],
        required: true,
        group: "safety",
      },
      {
        key: "combustibles_radius_m",
        label: "Combustibles cleared radius",
        kind: "number",
        unit: "m",
        min: 5,
        max: 50,
        required: true,
        group: "safety",
      },
      { key: "gas_lel_percent", label: "Flammable gas", kind: "number", unit: "% LEL", required: true, group: "gas" },
      { key: "gas_o2_percent", label: "Oxygen", kind: "number", unit: "% O2", required: true, group: "gas" },
      { key: "gas_test_time", label: "Gas test taken at", kind: "datetime", required: true, group: "gas" },
    ],
    crossCheck: gasTestProblems,
  },

  CONFINED_SPACE: {
    key: "CONFINED_SPACE",
    label: "Confined Space Entry",
    short: "Confined space",
    summary: "Entry into a tank, vessel, pit or duct where the atmosphere can kill you.",
    approvers: ["AREA_OWNER", "SAFETY_OFFICER"],
    defaultValidityHours: 8,
    conflictsWith: ["HOT_WORK"],
    fields: [
      { key: "space_id", label: "Space ID", kind: "text", required: true, group: "job", help: "Tank / vessel / pit identifier from the plant register." },
      { key: "entry_point", label: "Entry point", kind: "text", required: true, group: "job" },
      { key: "gas_o2_percent", label: "Oxygen", kind: "number", unit: "% O2", required: true, group: "gas" },
      { key: "gas_lel_percent", label: "Flammable gas", kind: "number", unit: "% LEL", required: true, group: "gas" },
      { key: "gas_h2s_ppm", label: "H2S", kind: "number", unit: "ppm", required: true, group: "gas" },
      { key: "gas_co_ppm", label: "Carbon monoxide", kind: "number", unit: "ppm", required: true, group: "gas" },
      { key: "gas_test_time", label: "Gas test taken at", kind: "datetime", required: true, group: "gas" },
      { key: "standby_attendant", label: "Standby attendant", kind: "text", required: true, group: "safety", help: "Somebody stays at the entry point and does not enter." },
      { key: "ventilation", label: "Ventilation method", kind: "select", options: ["Forced air blower", "Extractor", "Natural draft"], required: true, group: "safety" },
      { key: "rescue_plan", label: "Rescue plan", kind: "textarea", required: true, group: "safety", help: "How a rescue happens without a second casualty." },
      { key: "entry_exit_log", label: "Entry / exit log", kind: "textarea", group: "safety", help: "One line per entry: name, in, out." },
    ],
    crossCheck: (data, ctx) => {
      const problems = gasTestProblems(data, ctx);
      const h2s = num(data.gas_h2s_ppm);
      if (h2s !== null && h2s > GAS_LIMITS.h2sMax) {
        problems.push(`H2S is ${h2s} ppm — entry is not permitted above ${GAS_LIMITS.h2sMax} ppm.`);
      }
      const co = num(data.gas_co_ppm);
      if (co !== null && co > GAS_LIMITS.coMax) {
        problems.push(`CO is ${co} ppm — entry is not permitted above ${GAS_LIMITS.coMax} ppm.`);
      }
      return problems;
    },
  },

  WORKING_AT_HEIGHT: {
    key: "WORKING_AT_HEIGHT",
    label: "Working at Height",
    short: "Work at height",
    summary: "Anything above 1.8 m, or where a fall could injure somebody below.",
    approvers: ["AREA_OWNER", "SAFETY_OFFICER"],
    defaultValidityHours: 8,
    conflictsWith: [],
    fields: [
      { key: "height_m", label: "Height", kind: "number", unit: "m", min: 0, max: 200, required: true, group: "job" },
      { key: "access_method", label: "Access method", kind: "select", options: ["Scaffold", "Ladder", "MEWP", "Rope access"], required: true, group: "job" },
      { key: "fall_arrest", label: "Fall arrest equipment", kind: "text", required: true, group: "safety", help: "Harness, lanyard, inertia reel — what stops the fall." },
      { key: "anchor_point_checked", label: "Anchor point checked", kind: "checkbox", required: true, group: "safety" },
      { key: "barricade_below", label: "Area below barricaded", kind: "checkbox", required: true, group: "safety" },
    ],
    crossCheck: (data) => {
      const problems: string[] = [];
      const height = num(data.height_m);
      const method = str(data.access_method);
      if (height !== null && height > 1.8 && !str(data.fall_arrest)) {
        problems.push("Above 1.8 m, fall arrest equipment is mandatory.");
      }
      if (method === "Scaffold" && !data.anchor_point_checked) {
        problems.push("Scaffold work needs the anchor / tie point checked before entry.");
      }
      return problems;
    },
  },

  /**
   * The fifth type. It was added after the other four were built and needed no
   * change to the schema, the form, the API, the approvals or the state
   * machine — which is the point of modelling permits as one entity.
   */
  EXCAVATION: {
    key: "EXCAVATION",
    label: "Excavation",
    short: "Excavation",
    summary: "Any dig below 1.2 m, or anywhere near buried services.",
    approvers: ["AREA_OWNER", "SAFETY_OFFICER"],
    defaultValidityHours: 8,
    conflictsWith: [],
    fields: [
      { key: "depth_m", label: "Depth", kind: "number", unit: "m", min: 0, max: 10, required: true, group: "job" },
      { key: "shoring_method", label: "Shoring / protection", kind: "select", options: ["Shoring", "Benching", "Trench box"], required: true, group: "safety" },
      { key: "buried_services_checked", label: "Buried services checked and marked", kind: "checkbox", required: true, group: "safety" },
      { key: "access_egress", label: "Access and escape", kind: "text", required: true, group: "safety", help: "Ladder within 7.5 m of where people are working." },
      { key: "gas_lel_percent", label: "Flammable gas", kind: "number", unit: "% LEL", group: "gas" },
    ],
    crossCheck: (data) => {
      const problems: string[] = [];
      const depth = num(data.depth_m);
      const lel = num(data.gas_lel_percent);
      if (depth !== null && depth > 1.2 && !str(data.shoring_method)) {
        problems.push("Below 1.2 m the trench has to be shored, benched or boxed.");
      }
      if (depth !== null && depth > 1.5 && lel !== null && lel > GAS_LIMITS.lelMax) {
        problems.push(`Flammable gas is ${lel}% LEL in the excavation — entry is not permitted.`);
      }
      return problems;
    },
  },

  LOTO: {
    key: "LOTO",
    label: "Electrical / Isolation (LOTO)",
    short: "LOTO",
    summary: "Lock out, tag out, test dead — before anyone touches a conductor.",
    approvers: ["AREA_OWNER", "SAFETY_OFFICER"],
    defaultValidityHours: 8,
    conflictsWith: [],
    fields: [
      { key: "equipment_tag", label: "Equipment tag", kind: "text", required: true, group: "job" },
      { key: "voltage_level", label: "Voltage level", kind: "select", options: ["24 V control", "415 V LV", "11 kV HV", "33 kV HV"], required: true, group: "job" },
      { key: "isolation_points", label: "Isolation points", kind: "textarea", required: true, group: "safety", help: "Every point that must be opened, one per line." },
      { key: "lock_numbers", label: "Lock numbers", kind: "text", required: true, group: "safety" },
      { key: "tag_numbers", label: "Tag numbers", kind: "text", required: true, group: "safety" },
      { key: "earthing_applied", label: "Earthing applied", kind: "checkbox", group: "safety" },
      { key: "tested_dead_by", label: "Tested dead by", kind: "text", required: true, group: "safety" },
    ],
    crossCheck: (data) => {
      const problems: string[] = [];
      const voltage = str(data.voltage_level);
      if (voltage.includes("HV") && !data.earthing_applied) {
        problems.push("High-voltage isolation requires earthing to be applied.");
      }
      if (!str(data.tested_dead_by)) {
        problems.push("Somebody has to be named as having tested the circuit dead.");
      }
      return problems;
    },
  },
};

export const PERMIT_TYPE_KEYS = Object.keys(PERMIT_TYPES) as PermitTypeKey[];

export function isPermitType(value: unknown): value is PermitTypeKey {
  return typeof value === "string" && value in PERMIT_TYPES;
}

export type FieldError = { field: string; message: string };

/**
 * Server-side validation of the type-specific block. Field-level rules come
 * from the definitions; cross-field rules come from the type's own function.
 */
export function validateTypeData(
  type: PermitTypeKey,
  data: Record<string, unknown>,
  ctx: CrossCheckContext,
): FieldError[] {
  const def = PERMIT_TYPES[type];
  const errors: FieldError[] = [];

  for (const field of def.fields) {
    const raw = data[field.key];
    const empty =
      raw === undefined ||
      raw === null ||
      raw === "" ||
      (field.kind === "checkbox" && raw !== true);

    if (field.required && empty) {
      errors.push({ field: field.key, message: `${field.label} is required for ${def.label}.` });
      continue;
    }
    if (empty) continue;

    if (field.kind === "number") {
      const value = num(raw);
      if (value === null) {
        errors.push({ field: field.key, message: `${field.label} must be a number.` });
        continue;
      }
      if (field.min !== undefined && value < field.min) {
        errors.push({ field: field.key, message: `${field.label} cannot be below ${field.min}${field.unit ?? ""}.` });
      }
      if (field.max !== undefined && value > field.max) {
        errors.push({ field: field.key, message: `${field.label} cannot be above ${field.max}${field.unit ?? ""}.` });
      }
    }

    if (field.kind === "select" && field.options && !field.options.includes(String(raw))) {
      errors.push({ field: field.key, message: `${field.label} must be one of: ${field.options.join(", ")}.` });
    }

    if (field.kind === "datetime" && Number.isNaN(new Date(String(raw)).getTime())) {
      errors.push({ field: field.key, message: `${field.label} must be a valid date and time.` });
    }
  }

  if (def.crossCheck) {
    for (const message of def.crossCheck(data, ctx)) {
      errors.push({ field: guessFieldFor(def, message), message });
    }
  }

  return errors;
}

function guessFieldFor(def: PermitTypeDef, message: string): string {
  const lower = message.toLowerCase();
  if (lower.startsWith("gas test")) return "gas_test_time";
  if (lower.startsWith("oxygen")) return "gas_o2_percent";
  if (lower.startsWith("flammable gas")) return "gas_lel_percent";
  if (lower.startsWith("h2s")) return "gas_h2s_ppm";
  if (lower.startsWith("co ")) return "gas_co_ppm";
  if (lower.includes("fall arrest")) return "fall_arrest";
  if (lower.includes("earthing")) return "earthing_applied";
  return def.fields[0]?.key ?? "type_data";
}

/** Human-readable answers for the detail screen. */
export function describeTypeData(
  type: PermitTypeKey,
  data: Record<string, unknown>,
): { key: string; label: string; value: string }[] {
  return PERMIT_TYPES[type].fields
    .map((field) => {
      const raw = data[field.key];
      if (raw === undefined || raw === null || raw === "") return null;
      let value: string;
      if (field.kind === "checkbox") value = raw === true ? "Yes" : "No";
      else if (field.kind === "datetime") value = formatDateTime(String(raw));
      else value = `${String(raw)}${field.unit ? ` ${field.unit}` : ""}`;
      return { key: field.key, label: field.label, value };
    })
    .filter((row): row is { key: string; label: string; value: string } => row !== null);
}

/**
 * Gas readings rendered for the detail screen: the safety officer reads these
 * numbers before signing, so pass/fail is shown against the actual limits
 * rather than left as raw text.
 */
export function evaluateGasReadings(
  type: PermitTypeKey,
  data: Record<string, unknown>,
): { label: string; value: string; state: "pass" | "fail" }[] {
  const limits: Record<string, (value: number) => boolean> = {
    gas_o2_percent: (value) => value >= GAS_LIMITS.o2Min && value <= GAS_LIMITS.o2Max,
    gas_lel_percent: (value) => value <= GAS_LIMITS.lelMax,
    gas_h2s_ppm: (value) => value <= GAS_LIMITS.h2sMax,
    gas_co_ppm: (value) => value <= GAS_LIMITS.coMax,
  };

  return PERMIT_TYPES[type].fields
    .filter((field) => field.key in limits)
    .map((field) => {
      const raw = num(data[field.key]);
      return {
        label: field.label,
        value: raw === null ? "—" : `${raw}${field.unit ? ` ${field.unit}` : ""}`,
        state: raw === null || !limits[field.key](raw) ? ("fail" as const) : ("pass" as const),
      };
    });
}

export function formatDateTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return new Intl.DateTimeFormat("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: "Asia/Kolkata",
  }).format(date);
}
