import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { setSessionCookie, verifyPassword, type SessionUser, type Role } from "@/lib/auth";

const schema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Email and password are required." }, { status: 400 });
  }

  const handle = await db();
  const row = await handle
    .prepare("SELECT id, email, name, role, password_hash, area_id, plant_id FROM users WHERE lower(email) = lower(?)")
    .bind(parsed.data.email.trim())
    .first<{
      id: string;
      email: string;
      name: string;
      role: Role;
      password_hash: string;
      area_id: string | null;
      plant_id: string | null;
    }>();

  if (!row || !(await verifyPassword(parsed.data.password, row.password_hash))) {
    return NextResponse.json({ error: "Wrong email or password." }, { status: 401 });
  }

  const user: SessionUser = {
    id: row.id,
    email: row.email,
    name: row.name,
    role: row.role,
    areaId: row.area_id,
    plantId: row.plant_id,
  };
  await setSessionCookie(user);
  return NextResponse.json({ ok: true, user: { id: user.id, role: user.role, name: user.name } });
}
