"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { PERMIT_TYPES, PERMIT_TYPE_KEYS, type PermitTypeKey } from "@/lib/permits/registry";
import type { Area, Equipment } from "@/lib/permits/repo";

const HAZARDS = [
  "Open flame",
  "Sparks",
  "Hot surface",
  "Electric shock",
  "Arc flash",
  "Fall from height",
  "Falling objects",
  "Oxygen deficiency",
  "Toxic gas",
  "Flammable vapour",
  "Rotating equipment",
  "Manual handling",
  "Noise",
];

const PPE = [
  "Helmet",
  "Safety shoes",
  "Safety goggles",
  "Face shield",
  "Leather gloves",
  "Insulating gloves",
  "FR coverall",
  "Full body harness",
  "SCBA",
  "Dust mask",
  "Ear plugs",
];

const PRECAUTIONS = [
  "Area barricaded",
  "Fire extinguisher at site",
  "Fire watch posted",
  "Combustibles cleared 10 m",
  "Gas test done",
  "Isolation locked and tagged",
  "Tested dead",
  "Standing attendant posted",
  "Rescue plan briefed",
  "Tools tethered",
  "Ventilation rigged",
  "Neighbours informed",
];

const PRESETS: Record<PermitTypeKey, { hazards: string[]; ppe: string[]; precautions: string[] }> = {
  HOT_WORK: {
    hazards: ["Open flame", "Sparks", "Hot surface"],
    ppe: ["Helmet", "Safety shoes", "Face shield", "Leather gloves", "FR coverall"],
    precautions: ["Fire extinguisher at site", "Fire watch posted", "Combustibles cleared 10 m", "Gas test done"],
  },
  CONFINED_SPACE: {
    hazards: ["Oxygen deficiency", "Toxic gas", "Flammable vapour"],
    ppe: ["Helmet", "Safety shoes", "Full body harness", "SCBA"],
    precautions: ["Isolation locked and tagged", "Gas test done", "Standing attendant posted", "Rescue plan briefed", "Ventilation rigged"],
  },
  WORKING_AT_HEIGHT: {
    hazards: ["Fall from height", "Falling objects"],
    ppe: ["Helmet", "Safety shoes", "Full body harness"],
    precautions: ["Area barricaded", "Tools tethered"],
  },
  LOTO: {
    hazards: ["Electric shock", "Arc flash", "Rotating equipment"],
    ppe: ["Helmet", "Safety shoes", "Insulating gloves", "Face shield"],
    precautions: ["Isolation locked and tagged", "Tested dead", "Area barricaded"],
  },
  EXCAVATION: {
    hazards: ["Buried services", "Trench collapse", "Flammable vapour", "Falling into the trench"],
    ppe: ["Helmet", "Safety shoes", "High-visibility vest"],
    precautions: ["Area barricaded", "Neighbours informed", "Gas test done"],
  },
};

function toLocalInput(date: Date): string {
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

const STEPS = ["Type & job", "Hazards & PPE", "Type details", "Review"];

export default function NewPermitForm({
  areas,
  equipment,
}: {
  areas: Area[];
  equipment: Equipment[];
}) {
  const router = useRouter();
  const [step, setStep] = useState(0);
  const [type, setType] = useState<PermitTypeKey>("HOT_WORK");
  const [areaId, setAreaId] = useState(areas[0]?.id ?? "");
  const [equipmentId, setEquipmentId] = useState("");
  const [contractor, setContractor] = useState("");
  const [workDescription, setWorkDescription] = useState("");
  const [locationDetails, setLocationDetails] = useState("");
  const [start, setStart] = useState(toLocalInput(new Date(Date.now() + 60 * 60_000)));
  const [end, setEnd] = useState(toLocalInput(new Date(Date.now() + 9 * 60 * 60_000)));
  const [hazards, setHazards] = useState<string[]>(PRESETS.HOT_WORK.hazards);
  const [ppe, setPpe] = useState<string[]>(PRESETS.HOT_WORK.ppe);
  const [precautions, setPrecautions] = useState<string[]>(PRESETS.HOT_WORK.precautions);
  const [typeData, setTypeData] = useState<Record<string, unknown>>({});
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<{ field: string; message: string }[]>([]);
  const [conflict, setConflict] = useState<string | null>(null);
  const [busy, setBusy] = useState<"draft" | "submit" | null>(null);

  const typeDef = PERMIT_TYPES[type];
  const areaEquipment = useMemo(
    () => equipment.filter((item) => item.areaId === areaId),
    [equipment, areaId],
  );

  function pickType(next: PermitTypeKey) {
    setType(next);
    setHazards(PRESETS[next].hazards);
    setPpe(PRESETS[next].ppe);
    setPrecautions(PRESETS[next].precautions);
    setTypeData({});
  }

  function toggle(list: string[], value: string, setter: (next: string[]) => void) {
    setter(list.includes(value) ? list.filter((item) => item !== value) : [...list, value]);
  }

  function validateStep(index: number): string | null {
    if (index === 0) {
      if (!areaId) return "Pick the area the work happens in.";
      if (workDescription.trim().length < 12) return "Describe the job — a dozen words, not 'weld'.";
      if (new Date(end).getTime() <= new Date(start).getTime()) return "The window has to end after it starts.";
    }
    if (index === 1) {
      if (!hazards.length) return "Tick at least one hazard.";
      if (!ppe.length) return "Tick the PPE required.";
    }
    if (index === 2) {
      const missing = typeDef.fields.filter((field) => {
        if (!field.required) return false;
        const value = typeData[field.key];
        return field.kind === "checkbox" ? value !== true : value === undefined || value === "";
      });
      if (missing.length) return `Still needed: ${missing.map((field) => field.label).join(", ")}.`;
    }
    return null;
  }

  function go(next: number) {
    const problem = next > step ? validateStep(step) : null;
    if (problem) {
      setError(problem);
      return;
    }
    setError(null);
    setStep(next);
  }

  async function save(submit: boolean, acknowledgeConflict = false) {
    const problem = validateStep(2) ?? validateStep(1) ?? validateStep(0);
    if (problem) {
      setError(problem);
      return;
    }
    setBusy(submit ? "submit" : "draft");
    setError(null);
    setConflict(null);
    setFieldErrors([]);

    // datetime fields hold a local "YYYY-MM-DDTHH:mm" from the input; the server is UTC, so send
    // a real instant or a 17:45 IST reading is read as 17:45 UTC and rejected as "in the future".
    const isoTypeData = Object.fromEntries(
      Object.entries(typeData).map(([key, value]) => {
        const field = typeDef.fields.find((item) => item.key === key);
        if (field?.kind === "datetime" && typeof value === "string" && value) {
          const parsed = new Date(value);
          return [key, Number.isNaN(parsed.getTime()) ? value : parsed.toISOString()];
        }
        return [key, value];
      }),
    );

    const payload = {
      type,
      areaId,
      equipmentId: equipmentId || null,
      contractor: contractor || null,
      workDescription,
      locationDetails: locationDetails || null,
      plannedStart: new Date(start).toISOString(),
      plannedEnd: new Date(end).toISOString(),
      hazards,
      ppe,
      precautions,
      typeData: isoTypeData,
      submit,
      acknowledgeConflict,
    };

    const response = await fetch("/api/permits", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    });
    const data = (await response.json().catch(() => ({}))) as {
      error?: string;
      code?: string;
      fieldErrors?: { field: string; message: string }[];
      permit?: { id: string };
    };
    setBusy(null);

    if (response.status === 409 && data.code === "CONFLICT") {
      setConflict(data.error ?? "This job overlaps another permit in the same area.");
      return;
    }
    if (!response.ok) {
      setError(data.error ?? "Could not save the permit.");
      setFieldErrors(data.fieldErrors ?? []);
      return;
    }
    if (data.permit) {
      router.push(`/permits/${data.permit.id}`);
      router.refresh();
    }
  }

  return (
    <div className="card">
      <div className="steps">
        {STEPS.map((label, index) => (
          <div
            className="step"
            key={label}
            data-state={index === step ? "current" : index < step ? "done" : "todo"}
          >
            <span className="num">{index + 1}</span>
            {label}
          </div>
        ))}
      </div>

      <div style={{ padding: 18 }}>
        {step === 0 ? (
          <div className="form-grid">
            <div>
              <legend>Permit type</legend>
              <div className="type-pick">
                {PERMIT_TYPE_KEYS.map((key) => (
                  <button
                    key={key}
                    type="button"
                    className="type-card"
                    aria-pressed={type === key}
                    onClick={() => pickType(key)}
                  >
                    <strong>{PERMIT_TYPES[key].label}</strong>
                    <span>{PERMIT_TYPES[key].summary}</span>
                  </button>
                ))}
              </div>
            </div>

            <div className="form-grid two">
              <div className="field">
                <label htmlFor="area">Area</label>
                <select
                  id="area"
                  value={areaId}
                  onChange={(event) => {
                    setAreaId(event.target.value);
                    setEquipmentId("");
                  }}
                >
                  {areas.map((area) => (
                    <option key={area.id} value={area.id}>
                      {area.plantName} · {area.name}
                    </option>
                  ))}
                </select>
              </div>
              <div className="field">
                <label htmlFor="equipment">Equipment</label>
                <select
                  id="equipment"
                  value={equipmentId}
                  onChange={(event) => setEquipmentId(event.target.value)}
                >
                  <option value="">Not equipment specific</option>
                  {areaEquipment.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.tag} — {item.name}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div className="field">
              <label htmlFor="description">What is the job?</label>
              <textarea
                id="description"
                value={workDescription}
                onChange={(event) => setWorkDescription(event.target.value)}
                placeholder="Weld a mounting bracket onto the press frame — crack found at shift start."
              />
            </div>

            <div className="form-grid two">
              <div className="field">
                <label htmlFor="contractor">Contractor / team</label>
                <input
                  id="contractor"
                  value={contractor}
                  onChange={(event) => setContractor(event.target.value)}
                  placeholder="Sakthi Fabrication"
                />
              </div>
              <div className="field">
                <label htmlFor="location">Exact location</label>
                <input
                  id="location"
                  value={locationDetails}
                  onChange={(event) => setLocationDetails(event.target.value)}
                  placeholder="Line A, bay 3, north side of the press"
                />
              </div>
            </div>

            <div className="form-grid two">
              <div className="field">
                <label htmlFor="start">Planned start</label>
                <input
                  id="start"
                  type="datetime-local"
                  value={start}
                  onChange={(event) => setStart(event.target.value)}
                />
              </div>
              <div className="field">
                <label htmlFor="end">Planned end</label>
                <input
                  id="end"
                  type="datetime-local"
                  value={end}
                  onChange={(event) => setEnd(event.target.value)}
                />
              </div>
            </div>
            <p className="tiny muted" style={{ margin: 0 }}>
              A permit covers one shift, maximum 12 hours. It cannot be started before the window opens.
            </p>
          </div>
        ) : null}

        {step === 1 ? (
          <div className="form-grid">
            <fieldset>
              <legend>Hazards identified</legend>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))" }}>
                {HAZARDS.map((hazard) => (
                  <label className="checkline" key={hazard}>
                    <input
                      type="checkbox"
                      checked={hazards.includes(hazard)}
                      onChange={() => toggle(hazards, hazard, setHazards)}
                    />
                    {hazard}
                  </label>
                ))}
              </div>
            </fieldset>

            <fieldset>
              <legend>PPE required</legend>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))" }}>
                {PPE.map((item) => (
                  <label className="checkline" key={item}>
                    <input
                      type="checkbox"
                      checked={ppe.includes(item)}
                      onChange={() => toggle(ppe, item, setPpe)}
                    />
                    {item}
                  </label>
                ))}
              </div>
            </fieldset>

            <fieldset>
              <legend>Precautions in place</legend>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))" }}>
                {PRECAUTIONS.map((item) => (
                  <label className="checkline" key={item}>
                    <input
                      type="checkbox"
                      checked={precautions.includes(item)}
                      onChange={() => toggle(precautions, item, setPrecautions)}
                    />
                    {item}
                  </label>
                ))}
              </div>
            </fieldset>
          </div>
        ) : null}

        {step === 2 ? (
          <div className="form-grid">
            <div className="notice">
              <strong>{typeDef.label}</strong> — {typeDef.summary}
            </div>
            <div className="form-grid two">
              {typeDef.fields.map((field) => {
                const value = typeData[field.key];
                const id = `field-${field.key}`;
                const onChange = (next: unknown) =>
                  setTypeData((current) => ({ ...current, [field.key]: next }));

                if (field.kind === "checkbox") {
                  return (
                    <label className="checkline" key={field.key} style={{ gridColumn: "1 / -1" }}>
                      <input
                        id={id}
                        type="checkbox"
                        checked={value === true}
                        onChange={(event) => onChange(event.target.checked)}
                      />
                      <span>
                        {field.label}
                        {field.required ? <span className="err"> *</span> : null}
                        {field.help ? <span className="muted small"> — {field.help}</span> : null}
                      </span>
                    </label>
                  );
                }

                return (
                  <div
                    className="field"
                    key={field.key}
                    style={field.kind === "textarea" ? { gridColumn: "1 / -1" } : undefined}
                  >
                    <label htmlFor={id}>
                      {field.label}
                      {field.unit ? <span className="muted"> ({field.unit})</span> : null}
                      {field.required ? <span className="err"> *</span> : null}
                    </label>
                    {field.kind === "select" ? (
                      <select
                        id={id}
                        value={String(value ?? "")}
                        onChange={(event) => onChange(event.target.value)}
                      >
                        <option value="">Select…</option>
                        {field.options?.map((option) => (
                          <option key={option} value={option}>
                            {option}
                          </option>
                        ))}
                      </select>
                    ) : field.kind === "textarea" ? (
                      <textarea
                        id={id}
                        value={String(value ?? "")}
                        onChange={(event) => onChange(event.target.value)}
                        placeholder={field.help}
                      />
                    ) : field.kind === "datetime" ? (
                      <input
                        id={id}
                        type="datetime-local"
                        value={String(value ?? "")}
                        onChange={(event) => onChange(event.target.value)}
                      />
                    ) : (
                      <input
                        id={id}
                        type={field.kind === "number" ? "number" : "text"}
                        value={String(value ?? "")}
                        min={field.min}
                        max={field.max}
                        onChange={(event) => onChange(event.target.value)}
                        placeholder={field.help}
                      />
                    )}
                    {field.help && field.kind !== "textarea" ? (
                      <span className="tiny muted">{field.help}</span>
                    ) : null}
                  </div>
                );
              })}
            </div>
          </div>
        ) : null}

        {step === 3 ? (
          <div className="form-grid">
            <div className="notice">
              <strong>{typeDef.label}</strong> in{" "}
              {areas.find((area) => area.id === areaId)?.name} —{" "}
              {new Date(start).toLocaleString("en-IN")} to {new Date(end).toLocaleString("en-IN")}
            </div>
            <p style={{ margin: 0 }}>{workDescription}</p>
            <div className="chips">
              {hazards.map((hazard) => (
                <span className="chip" data-warn="true" key={hazard}>
                  {hazard}
                </span>
              ))}
            </div>
            <div className="chips">
              {ppe.map((item) => (
                <span className="chip" key={item}>
                  {item}
                </span>
              ))}
            </div>
            <div className="chips">
              {precautions.map((item) => (
                <span className="chip" key={item}>
                  ✓ {item}
                </span>
              ))}
            </div>
            <div className="small muted">
              Submitting creates two approvals: area owner, then safety officer. Work cannot start until
              both sign and the window has opened.
            </div>
          </div>
        ) : null}

        {error ? (
          <div className="notice" data-tone="danger" style={{ marginTop: 14 }}>
            {error}
            {fieldErrors.filter((item) => item.message !== error).length ? (
              <ul className="small" style={{ margin: "6px 0 0", paddingLeft: 18 }}>
                {fieldErrors
                  .filter((item) => item.message !== error)
                  .slice(0, 6)
                  .map((item, index) => (
                    <li key={`${item.field}-${index}`}>{item.message}</li>
                  ))}
              </ul>
            ) : null}
          </div>
        ) : null}

        {conflict ? (
          <div className="notice" data-tone="warn" style={{ marginTop: 14 }}>
            <strong>Conflict detected.</strong> {conflict}
            <div className="btn-row" style={{ marginTop: 10 }}>
              <button className="btn btn-sm" type="button" onClick={() => save(true, true)}>
                Submit anyway (recorded in the audit log)
              </button>
            </div>
          </div>
        ) : null}
      </div>

      <div className="footer-actions">
        <button className="btn" type="button" onClick={() => go(step - 1)} disabled={step === 0 || busy !== null}>
          Back
        </button>
        {step < 3 ? (
          <button className="btn btn-primary" type="button" onClick={() => go(step + 1)}>
            Continue
          </button>
        ) : (
          <>
            <button className="btn" type="button" disabled={busy !== null} onClick={() => save(false)}>
              {busy === "draft" ? "Saving…" : "Save as draft"}
            </button>
            <button className="btn btn-primary" type="button" disabled={busy !== null} onClick={() => save(true)}>
              {busy === "submit" ? "Submitting…" : "Submit for approval"}
            </button>
          </>
        )}
        {step < 3 ? (
          <button className="btn btn-ghost" type="button" disabled={busy !== null} onClick={() => save(false)}>
            {busy === "draft" ? "Saving…" : "Save draft"}
          </button>
        ) : null}
      </div>
    </div>
  );
}
