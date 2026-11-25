import { describe, expect, it } from "vitest";
import {
  PERMIT_TYPES,
  PERMIT_TYPE_KEYS,
  describeTypeData,
  evaluateGasReadings,
  validateTypeData,
} from "@/lib/permits/registry";

const start = new Date("2026-04-02T06:00:00.000Z");
const ctx = { plannedStart: start };

function hotWorkData(overrides: Record<string, unknown> = {}) {
  return {
    hot_work_kind: "Welding",
    fire_watch: "Suresh",
    extinguisher_type: "ABC dry powder",
    combustibles_radius_m: 10,
    gas_lel_percent: 2,
    gas_o2_percent: 20.9,
    gas_test_time: new Date(start.getTime() - 20 * 60_000).toISOString(),
    ...overrides,
  };
}

describe("type registry", () => {
  it("covers every permit type the spec asks for, with shared core rules", () => {
    expect(PERMIT_TYPE_KEYS).toEqual(
      expect.arrayContaining(["HOT_WORK", "CONFINED_SPACE", "WORKING_AT_HEIGHT", "LOTO"]),
    );
    for (const key of PERMIT_TYPE_KEYS) {
      expect(PERMIT_TYPES[key].fields.length).toBeGreaterThan(0);
      expect(PERMIT_TYPES[key].approvers).toEqual(["AREA_OWNER", "SAFETY_OFFICER"]);
    }
  });

  it("carries a fifth type (Excavation) with no special-casing anywhere", () => {
    // Excavation was added after the other four: one registry entry, no schema
    // change, no new form, no new endpoint. It validates through the same code.
    expect(validateTypeData(
      "EXCAVATION",
      { depth_m: 2, shoring_method: "Trench box", buried_services_checked: true, access_egress: "Ladder at 5 m" },
      ctx,
    )).toEqual([]);

    const shallowButUnshored = validateTypeData(
      "EXCAVATION",
      { depth_m: 2, buried_services_checked: true, access_egress: "Ladder" },
      ctx,
    );
    expect(shallowButUnshored.some((error) => error.field === "shoring_method")).toBe(true);
  });
});

describe("hot work validation", () => {
  it("accepts a complete permit with a recent gas test", () => {
    expect(validateTypeData("HOT_WORK", hotWorkData(), ctx)).toEqual([]);
  });

  it("refuses a flammable atmosphere above 10% LEL", () => {
    const errors = validateTypeData("HOT_WORK", hotWorkData({ gas_lel_percent: 18 }), ctx);
    expect(errors).toHaveLength(1);
    expect(errors[0].message).toContain("18% LEL");
    expect(errors[0].field).toBe("gas_lel_percent");
  });

  it("refuses an oxygen reading outside 19.5–23.5%", () => {
    const errors = validateTypeData("HOT_WORK", hotWorkData({ gas_o2_percent: 17 }), ctx);
    expect(errors.some((error) => error.field === "gas_o2_percent")).toBe(true);
  });

  it("refuses a gas test taken more than an hour before the start", () => {
    const errors = validateTypeData(
      "HOT_WORK",
      hotWorkData({ gas_test_time: new Date(start.getTime() - 90 * 60_000).toISOString() }),
      ctx,
    );
    expect(errors[0].field).toBe("gas_test_time");
    expect(errors[0].message).toContain("60 minutes");
  });

  it("requires a fire watch and an extinguisher", () => {
    const errors = validateTypeData("HOT_WORK", hotWorkData({ fire_watch: "", extinguisher_type: "" }), ctx);
    expect(errors.map((error) => error.field)).toEqual(
      expect.arrayContaining(["fire_watch", "extinguisher_type"]),
    );
  });
});

describe("confined space validation", () => {
  it("refuses entry with H2S above 10 ppm", () => {
    const errors = validateTypeData(
      "CONFINED_SPACE",
      {
        space_id: "TK-204",
        entry_point: "Top manhole",
        gas_o2_percent: 20.7,
        gas_lel_percent: 0,
        gas_h2s_ppm: 22,
        gas_co_ppm: 3,
        gas_test_time: new Date(start.getTime() - 10 * 60_000).toISOString(),
        standby_attendant: "Karthik",
        ventilation: "Forced air blower",
        rescue_plan: "Tripod and harness",
      },
      ctx,
    );
    expect(errors[0].field).toBe("gas_h2s_ppm");
  });
});

describe("height and LOTO", () => {
  it("makes fall arrest mandatory above 1.8 m", () => {
    const errors = validateTypeData(
      "WORKING_AT_HEIGHT",
      { height_m: 6, access_method: "Ladder", fall_arrest: "", anchor_point_checked: true, barricade_below: true },
      ctx,
    );
    expect(errors.some((error) => error.field === "fall_arrest")).toBe(true);
  });

  it("needs earthing for high-voltage isolation", () => {
    const errors = validateTypeData(
      "LOTO",
      {
        equipment_tag: "PCC-1",
        voltage_level: "11 kV HV",
        isolation_points: "Breaker 14",
        lock_numbers: "L-1",
        tag_numbers: "T-1",
        earthing_applied: false,
        tested_dead_by: "Ravi",
      },
      ctx,
    );
    expect(errors.some((error) => error.field === "earthing_applied")).toBe(true);
  });
});

describe("reading helpers", () => {
  it("marks failing gas readings so the detail screen can show them red", () => {
    const readings = evaluateGasReadings("HOT_WORK", hotWorkData({ gas_lel_percent: 18 }));
    const lel = readings.find((reading) => reading.label === "Flammable gas");
    expect(lel?.state).toBe("fail");
  });

  it("describes stored answers in plain language for the detail page", () => {
    const rows = describeTypeData("HOT_WORK", hotWorkData());
    expect(rows.find((row) => row.key === "combustibles_radius_m")?.value).toBe("10 m");
    expect(rows.find((row) => row.key === "gas_lel_percent")?.value).toBe("2 % LEL");
  });
});
