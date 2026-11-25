import { NextResponse } from "next/server";
import { requireApiUser } from "@/lib/guard";
import { listPermits } from "@/lib/permits/repo";
import { createPermit } from "@/lib/permits/service";
import { isPermitType } from "@/lib/permits/registry";
import { STATUSES, type PermitStatus } from "@/lib/permits/state";

/** GET /api/permits — the same scoping as the dashboard, for anyone who wants JSON. */
export async function GET(request: Request) {
  const auth = await requireApiUser();
  if (!auth.ok) return auth.response;

  const url = new URL(request.url);
  const statuses = url.searchParams
    .getAll("status")
    .filter((value): value is PermitStatus => (STATUSES as readonly string[]).includes(value));
  const types = url.searchParams.getAll("type").filter(isPermitType);
  const area = url.searchParams.get("area") ?? undefined;

  const permits = await listPermits({
    status: statuses.length ? statuses : undefined,
    type: types.length ? types : undefined,
    areaId: area,
    scope: { role: auth.user.role, id: auth.user.id, areaId: auth.user.areaId },
  });

  return NextResponse.json({ permits });
}

/** POST /api/permits — create a draft, or create and submit in one call. */
export async function POST(request: Request) {
  const auth = await requireApiUser();
  if (!auth.ok) return auth.response;

  const body = (await request.json().catch(() => null)) as
    | (Record<string, unknown> & { submit?: boolean; acknowledgeConflict?: boolean })
    | null;
  if (!body) return NextResponse.json({ error: "Expected a JSON body." }, { status: 400 });

  const result = await createPermit(auth.user, body as never, {
    submit: Boolean(body.submit),
    acknowledgeConflict: Boolean(body.acknowledgeConflict),
  });

  if (!result.ok) {
    return NextResponse.json(
      {
        error: result.error.message,
        code: result.error.code,
        fieldErrors: result.error.fieldErrors,
      },
      { status: result.error.status },
    );
  }

  return NextResponse.json(
    { permit: result.data.permit, conflicts: result.data.conflicts },
    { status: 201 },
  );
}
