/**
 * Schema as ordered, idempotent migrations.
 *
 * They live in TypeScript rather than .sql files because the app applies them at
 * runtime inside a Cloudflare Worker, where there is no filesystem to read at
 * boot. The statements are plain SQL — copying this array into a Postgres
 * migration file is a rename of TEXT->timestamptz and INTEGER->serial.
 */
export type Migration = { id: string; sql: string };

export const MIGRATIONS: Migration[] = [
  {
    id: "0001_init",
    sql: `
      CREATE TABLE IF NOT EXISTS plants (
        id          TEXT PRIMARY KEY,
        name        TEXT NOT NULL,
        code        TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS areas (
        id          TEXT PRIMARY KEY,
        plant_id    TEXT NOT NULL REFERENCES plants(id),
        name        TEXT NOT NULL,
        code        TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS equipment (
        id          TEXT PRIMARY KEY,
        area_id     TEXT NOT NULL REFERENCES areas(id),
        tag         TEXT NOT NULL,
        name        TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS users (
        id            TEXT PRIMARY KEY,
        email         TEXT NOT NULL UNIQUE,
        name          TEXT NOT NULL,
        role          TEXT NOT NULL CHECK (role IN ('REQUESTER','AREA_OWNER','SAFETY_OFFICER','ADMIN')),
        password_hash TEXT NOT NULL,
        area_id       TEXT REFERENCES areas(id),
        plant_id      TEXT REFERENCES plants(id),
        created_at    TEXT NOT NULL
      );

      -- One table for every permit type. Type-specific answers live in
      -- type_data (JSON) and are validated against the type registry on write,
      -- so a new type is a registry entry, not a new table or a copied form.
      CREATE TABLE IF NOT EXISTS permits (
        id                  TEXT PRIMARY KEY,
        code                TEXT NOT NULL UNIQUE,
        type                TEXT NOT NULL,
        plant_id            TEXT NOT NULL REFERENCES plants(id),
        area_id             TEXT NOT NULL REFERENCES areas(id),
        equipment_id        TEXT REFERENCES equipment(id),
        requester_id        TEXT NOT NULL REFERENCES users(id),
        contractor          TEXT,
        work_description    TEXT NOT NULL,
        location_details    TEXT,
        planned_start       TEXT NOT NULL,
        planned_end         TEXT NOT NULL,
        hazards             TEXT NOT NULL DEFAULT '[]',
        ppe                 TEXT NOT NULL DEFAULT '[]',
        precautions         TEXT NOT NULL DEFAULT '[]',
        type_data           TEXT NOT NULL DEFAULT '{}',
        status              TEXT NOT NULL,
        close_notes         TEXT,
        verification_notes  TEXT,
        extension_hours     INTEGER NOT NULL DEFAULT 0,
        extension_count     INTEGER NOT NULL DEFAULT 0,
        pending_extension_hours INTEGER NOT NULL DEFAULT 0,
        suspended_reason    TEXT,
        created_at          TEXT NOT NULL,
        updated_at          TEXT NOT NULL,
        submitted_at        TEXT,
        approved_at         TEXT,
        active_at           TEXT,
        suspended_at        TEXT,
        closed_at           TEXT
      );

      CREATE INDEX IF NOT EXISTS idx_permits_status ON permits(status);
      CREATE INDEX IF NOT EXISTS idx_permits_area ON permits(area_id);
      CREATE INDEX IF NOT EXISTS idx_permits_window ON permits(planned_start, planned_end);

      CREATE TABLE IF NOT EXISTS approvals (
        id            TEXT PRIMARY KEY,
        permit_id     TEXT NOT NULL REFERENCES permits(id),
        approver_role TEXT NOT NULL,
        approver_id   TEXT REFERENCES users(id),
        decision      TEXT NOT NULL CHECK (decision IN ('PENDING','APPROVED','REJECTED')),
        comment       TEXT,
        decided_at    TEXT,
        created_at    TEXT NOT NULL,
        UNIQUE (permit_id, approver_role)
      );

      CREATE INDEX IF NOT EXISTS idx_approvals_permit ON approvals(permit_id);

      -- Append only. There is no UPDATE or DELETE path in the repository layer.
      CREATE TABLE IF NOT EXISTS audit_log (
        id          TEXT PRIMARY KEY,
        permit_id   TEXT NOT NULL REFERENCES permits(id),
        actor_id    TEXT,
        actor_label TEXT NOT NULL,
        actor_role  TEXT NOT NULL,
        action      TEXT NOT NULL,
        field       TEXT,
        from_value  TEXT,
        to_value    TEXT,
        comment     TEXT,
        created_at  TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_audit_permit ON audit_log(permit_id, created_at);
    `,
  },
];
