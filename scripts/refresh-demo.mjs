/**
 * Refresh the live demo.
 *
 * The seed is relative to the moment it runs, so on a long-lived deployment the
 * "active, expiring" permit slowly ages out and the dashboard ends up with
 * nothing live. This script puts one back: it raises a hot-work permit through
 * the public API, has both approvers sign it, and starts it as the requester —
 * exactly the path a person would take, so the audit trail stays honest.
 *
 *   npm run demo:refresh
 *   DEMO_BASE=http://127.0.0.1:3000 npm run demo:refresh   # against local dev
 *
 * Safe to run repeatedly: every run adds one permit, nothing is deleted.
 */

const BASE = process.env.DEMO_BASE ?? "https://opmaint-permit-to-work-yzo656-preview.freebuff.site";
const PASSWORD = process.env.DEMO_PASSWORD ?? "permit1234";

let cookie = "";

async function login(email) {
  const res = await fetch(`${BASE}/api/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, password: PASSWORD }),
  });
  if (!res.ok) throw new Error(`login ${email} -> ${res.status} ${await res.text()}`);
  const raw = res.headers.getSetCookie ? res.headers.getSetCookie() : [res.headers.get("set-cookie")];
  cookie = raw.filter(Boolean).map((value) => value.split(";")[0]).join("; ");
}

async function api(path, method = "GET", body) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: { "content-type": "application/json", cookie },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    // A non-JSON body is still useful in the error message.
  }
  return { status: res.status, text, json };
}

async function act(permitId, payload, who) {
  const res = await api(`/api/permits/${permitId}/actions`, "POST", payload);
  if (res.status !== 200) throw new Error(`${who} ${payload.action}: ${res.status} ${res.text.slice(0, 300)}`);
  return res.json.permit;
}

const iso = (ms) => new Date(ms).toISOString();

async function main() {
  await login("arjun@opmaint.test");
  const list = await api("/api/permits");
  if (!list.json?.permits) throw new Error(`could not list permits: ${list.status} ${list.text.slice(0, 200)}`);

  const sample = list.json.permits.find((permit) => permit.area_name === "Assembly Line A" && permit.equipment_id);
  if (!sample) throw new Error("no Assembly Line A permit to copy ids from — is the database seeded?");

  const now = Date.now();

  await login("ravi@opmaint.test");
  const created = await api("/api/permits", "POST", {
    type: "HOT_WORK",
    areaId: sample.area_id,
    equipmentId: sample.equipment_id,
    contractor: "Sakthi Fabrication",
    workDescription: "Weld a patch onto the press hydraulic line after a pinhole leak at shift start.",
    locationDetails: "Line A, bay 3, under the press ram",
    plannedStart: iso(now - 2 * 60 * 1000),
    plannedEnd: iso(now + 65 * 60 * 1000),
    hazards: ["Open flame", "Sparks onto oil residue", "Hot metal"],
    ppe: ["Face shield", "Leather gloves", "FR coverall", "Safety shoes"],
    precautions: [
      "Fire extinguisher at site",
      "Fire watch posted",
      "Combustibles cleared 10 m",
      "Gas test before start",
    ],
    typeData: {
      hot_work_kind: "Welding",
      fire_watch: "Suresh (contractor supervisor)",
      extinguisher_type: "ABC dry powder",
      combustibles_radius_m: 10,
      gas_lel_percent: 2,
      gas_o2_percent: 20.9,
      gas_test_time: iso(now - 10 * 60 * 1000),
    },
    submit: true,
    acknowledgeConflict: true,
  });
  if (created.status !== 201) throw new Error(`create: ${created.status} ${created.text.slice(0, 400)}`);

  const permit = created.json.permit;
  console.log(`raised ${permit.code} (${permit.status})`);

  await login("meena@opmaint.test");
  let current = await act(permit.id, { action: "approve", comment: "Press locked off, area cleared, contractor briefed." }, "Meena");
  console.log(`Meena signed -> ${current.status}`);

  await login("arjun@opmaint.test");
  current = await act(
    permit.id,
    { action: "approve", comment: "Gas test verified on site; fire watch briefed, extinguisher in place." },
    "Arjun",
  );
  console.log(`Arjun signed -> ${current.status}`);

  await login("ravi@opmaint.test");
  current = await act(permit.id, { action: "activate" }, "Ravi");
  console.log(`Ravi started work -> ${current.status}`);

  console.log(`${permit.code} is live until ${permit.planned_end} (about 65 minutes).`);
}

main().catch((error) => {
  console.error("refresh failed:", error.message);
  process.exit(1);
});
