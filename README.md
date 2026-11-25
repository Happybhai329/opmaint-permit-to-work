# Permit to Work — Opmaint CMMS module

A Permit to Work module for a CMMS: hot work, confined space, work at height, LOTO — and a fifth type
(Excavation) added after the first four to prove the abstraction holds.

**Live:** https://opmaint-permit-to-work-yzo656-preview.freebuff.site  
**Login:** `arjun@opmaint.test` / `permit1234` (all four accounts are on the login screen)

**One permit entity, one state machine, one audit trail, and type-specific fields declared in a registry.**

---

## 1. Run it

```bash
bun install        # or npm install
bun run dev        # http://localhost:3000
```

The local dev server needs a D1 binding; `freebuff.wrangler.jsonc` provides one (Miniflare keeps the
SQLite file under `.wrangler/`). There is nothing else to configure and no environment file to fill in.

**No external services and no API keys are required** — no SaaS account, no third-party API, no
`.env`; the only secret is a `SESSION_SECRET` string (a dev placeholder is committed, and the live
deployment has its own random one), and the database is D1, which ships with the Worker runtime.

That is the whole setup. On the first request the app applies its migrations, then seeds two plants,
five areas, six equipment items, four users and eleven permits spread across every status — including
one active permit that expires inside the next two hours and two permits waiting for a signature.

Those windows are relative to the moment of seeding, so on a long-lived deployment the permits age out
and the dashboard eventually has nothing live. `npm run demo:refresh` puts one back: it raises a
hot-work permit through the public API, has both approvers sign it and starts the work, so the
countdown and the audit trail are real rather than hand-edited rows.

```bash
bun run test       # 42 tests: state machine + permission rules + type validation
bun run typecheck
bun run build
```

### Demo logins

| Role | Email | Password | Can do |
|---|---|---|---|
| Requester | `ravi@opmaint.test` | `permit1234` | Raise, submit, start, close own permits |
| Area Owner | `meena@opmaint.test` | `permit1234` | Approve only Assembly Line A |
| Safety Officer | `arjun@opmaint.test` | `permit1234` | Approve anything, suspend, grant extensions, verify closures |
| Admin | `divya@opmaint.test` | `permit1234` | Everything except approve their own permit |

A useful 60-second tour: sign in as **Ravi** → open the permit marked **Active** (`PTW-2026-0001` in
the seed) → sign in as
**Meena** → `/approvals` shows only Assembly Line A work → sign in as **Arjun** → suspend the live
permit, then try to approve a permit Ravi raised for Utility Block.

---

## 2. How it is built

**Stack:** Next.js 16 (App Router, React 19, TypeScript), Cloudflare D1 (SQLite) through the Workers
`DB` binding, hand-written SQL in a repository layer, Zod at the edge, PBKDF2 + HMAC-signed session
cookie for auth. No ORM, no UI framework, no component library. Deployed as a Worker with OpenNext;
the database, schema and queries are the same ones running locally.

**Why SQLite/D1 and not Postgres:** the deployed runtime is a Cloudflare Worker, where a TCP Postgres
connection is not available and an HTTP driver would be a different dependency for no benefit at this
size. D1 is a real database with a real schema and real SQL — nothing is stored in JSON files or in
memory. Every statement lives in `lib/permits/repo.ts`, the schema is a migration array, and timestamps
are ISO-8601 TEXT, so porting to Postgres is a change of client plus `TEXT → timestamptz` in
`lib/db/schema.ts`. The repository is the only file that would change.

**The permit abstraction** (`lib/permits/registry.ts`) is the part worth reviewing:

```ts
PERMIT_TYPES.HOT_WORK = {
  label: "Hot Work",
  approvers: ["AREA_OWNER", "SAFETY_OFFICER"],
  conflictsWith: ["CONFINED_SPACE"],
  fields: [
    { key: "gas_lel_percent", label: "Flammable gas", kind: "number", unit: "% LEL", required: true },
    …
  ],
  crossCheck: (data, ctx) => […],   // rules a single field can't express
}
```

- One `permits` table. Type answers live in `type_data` (JSON) and are validated on every write against
  the same definitions that render the form, so the form and the API cannot disagree.
- One creation form renders whichever type is picked. There is no `HotWorkForm.tsx`.
- One endpoint (`POST /api/permits/:id/actions`) moves every permit through every state.
- Adding **Excavation** was one object in the registry — no migration, no new route, no new screen.
  That is the test the brief set, and it is covered by `tests/registry.test.ts`.

**The state machine** (`lib/permits/state.ts`) is pure: `checkAction()` is the single gate used by both
the UI and the API, `availableActions()` is derived from it (so a user never sees a button the server
would refuse), and `nextStatus()` only promotes a permit to `APPROVED` when the last signature lands.

---

## 3. Rules the backend enforces (not the UI)

- Every required approver must approve before `ACTIVE` — checked again at activation, not only at approval.
- A permit cannot start before `planned_start`, and cannot start after `planned_end`.
- An expired permit is finished forever: `EXPIRED` is terminal, resuming is refused, a new permit is needed.
- Nothing can be acted on unless the action is legal for the current status; the API answers `409` with the reason.
- **Nobody can approve their own permit**, whatever their role. Covered by a test.
- Area owners can only act on permits for their own area; the check is on the server, from the session.
- Approvals are unique per role and per permit; a second decision from the same approver is refused.
- Gas tests older than 60 minutes before the start are refused. 18% LEL is refused. H2S above 10 ppm is refused.
- Only requesters raise permits. Safety officers and area owners approve them — separation of duties.

Try to break it:

```bash
# sign in, keep the cookie
curl -c jar.txt -H 'content-type: application/json' \
  -d '{"email":"ravi@opmaint.test","password":"permit1234"}' localhost:3000/api/auth/login

# the requester trying to approve their own permit → 403 SELF_APPROVAL
curl -b jar.txt -H 'content-type: application/json' \
  -d '{"action":"approve"}' localhost:3000/api/permits/<permit-id>/actions

# activating an approved-but-future permit → 409 NOT_YET_VALID
curl -b jar.txt -H 'content-type: application/json' \
  -d '{"action":"activate"}' localhost:3000/api/permits/<permit-id>/actions

# rejecting without a reason → 422
curl -b jar.txt -H 'content-type: application/json' \
  -d '{"action":"reject"}' localhost:3000/api/permits/<permit-id>/actions
```

---

## 4. Screens

1. **Dashboard** — live count, expiring within two hours, approvals waiting on you, filters by status,
   type, area and date range, with a countdown on every active permit.
2. **Raise a permit** — four steps: type and job → hazards, PPE and precautions → the type's own fields
   → review. Drafts save and can be submitted later.
3. **Permit detail** — the full permit, the atmospheric readings with pass/fail against the real limits,
   the approval trail with comments, and the audit log as a readable timeline. Action buttons are
   computed per user and per state.
4. **Approvals** — what is waiting for this person's role, with the readings, hazards and claimed
   precautions in front of the decision. Approve with a comment, or reject with a mandatory reason.
5. **Closure** — the requester records what was done; the safety officer verifies the area and closes it.

Mobile: below 560 px the tables become cards and every button is at least 48 px tall, because the
person holding the phone is wearing gloves in sunlight.

---

## 5. Decisions I made where the spec was silent

1. **`type_data` is JSON, validated by the registry.** A table per type would double the schema for no
   query benefit; the fields are never searched individually. The validator is the guarantee, not the
   column type.
2. **Approvals are created at submit, not at create.** A draft has no approvers, so the dashboard can
   never show a pending approval for a permit that was never raised.
3. **Two approvers, both mandatory:** the area owner who owns the equipment, then the safety officer.
   The state machine refuses activation unless all rows are `APPROVED`.
4. **Only the requester closes; only the safety officer verifies.** One person cannot both finish and
   sign off their own job.
5. **Suspension is safety-officer-only.** A requester who needs to stop work cancels before activation,
   or closes after it — stopping a live permit is a safety act, not a clerical one.
6. **Extensions are capped at 4 hours, twice.** After that a new permit is raised, so a permit cannot
   quietly become a week-long permission.
7. **No editing after submission.** The spec asked for field edits to be logged; I removed the ability
   instead, which is stronger — the only post-submission changes are extensions and state changes, and
   every one of them is in the audit log.
8. **A permit covers at most 12 hours.** One shift, one permit; a "permit" that lasts a week is how
   people get hurt at 2 a.m. on day four.
9. **Conflicts are a warning, not a block.** Hot work and confined space cannot overlap in the same
   area. The requester can still submit with an explicit acknowledgement, which is written into the
   audit trail — because the real plant sometimes has a reason, and the record of who overrode it is
   worth more than a hard stop.
10. **Expiry is enforced on read, not by browser timers.** Every list, detail page and API call sweeps
    overdue permits to `EXPIRED` with a system audit entry, so a permit cannot stay "active" because
    nobody had the tab open. A cron trigger calling the same `sweepExpired()` is the production answer.
11. **The session cookie is signed with HMAC and carries no role authority** — the role is re-read from
    the database on every request, so changing a user's role takes effect immediately.

---

## 6. What I knowingly did not build (and would next)

- **No cron.** Expiry sweeps on request. Deployed on Workers, a `[triggers] crons` entry hitting an
  internal route would make it exact; the function already exists.
- **No QR code per permit** and **no canvas signature**, though the action body accepts a `signature`
  field. Both are on the "bits that separate good from average" list, and both are additive — the
  audit trail already records who approved and when, which is what an investigation actually needs.
- **No admin UI** for users, areas and equipment. Seeded data is the reference data; the tables exist
  and the schema is there.
- **No pagination or server-side search.** Eleven permits in the seed; the list query would need it at
  a few thousand.
- **No rate limiting or lockout** on login, and the demo password is shared on purpose. Real deployment
  needs both.
- **One area owner per area.** The schema allows more, the "unique per role" approval row does not —
  two area owners on the same permit would need a different approval key.
- **No integration tests against D1.** The state machine and registry are unit-tested (42 tests); the
  SQL paths were exercised by hand against the seeded database. If I had another day, `wrangler d1` in
  a test harness is where I would spend it.
- **Timezone is fixed to Asia/Kolkata** for display. A multi-country customer would need a per-plant
  timezone column.

---

## 7. Where I used AI

- Scaffolding the Next.js app shell and the CSS system, then editing both by hand.
- Drafting the first version of the seeded permits and the README structure.
- Reviewing the state machine for missing transitions — it found the "resume after the window has
  passed" hole, which is now a test.

Everything about the domain — the four types and their fields, the gas limits, the 60-minute test rule,
the two-approver model, cutting edits after submission, the conflict-acknowledgement compromise — came
from reading real permit forms (OSHA-style hot work permits, Indian factory PTW formats) and from
deciding what I would want to defend in front of a safety officer. I can explain every line in the
Loom, including the parts I would write differently now (see §6).

---

## 8. API surface

| Method | Path | Purpose |
|---|---|---|
| `POST` | `/api/auth/login` | Email + password → signed session cookie |
| `POST` | `/api/auth/logout` | Clears the cookie |
| `GET` | `/api/permits?status=&type=&area=` | Scoped list as JSON |
| `POST` | `/api/permits` | Create draft (`submit: false`) or create and submit |
| `GET` | `/api/permits/:id` | Permit + approvals + audit |
| `POST` | `/api/permits/:id/actions` | `submit`, `approve`, `reject`, `activate`, `suspend`, `resume`, `close`, `verify`, `cancel`, `request_extension`, `approve_extension` |

Errors are JSON: `{ "error": "…", "code": "SELF_APPROVAL" | "ILLEGAL_TRANSITION" | "CONFLICT" | … }`.

---

## 9. Layout

```
app/
  page.tsx                     dashboard
  approvals/page.tsx           approvals waiting on the signed-in user
  permits/new/page.tsx         raise a permit
  permits/[id]/page.tsx        permit detail, approvals, audit trail
  api/…                        login, list, detail, state changes
components/
  ActionPanel.tsx              the only place state changes are triggered
  NewPermitForm.tsx            registry-driven four-step form
  AuditTimeline.tsx            readable history, never a JSON dump
lib/
  auth.ts                      PBKDF2, HMAC cookie, current user
  db/                          D1 access, migrations, seed
  permits/registry.ts          type definitions + validation
  permits/state.ts             the state machine (pure)
  permits/service.ts           rules + writes, in one place
  permits/repo.ts              SQL
tests/                         state machine, permissions, type validation
```
