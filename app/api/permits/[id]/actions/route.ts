import { NextResponse } from "next/server";
import { requireApiUser } from "@/lib/guard";
import { actOnPermit, submitPermit, type ActionPayload } from "@/lib/permits/service";
import { ACTION_LABELS, type PermitAction } from "@/lib/permits/state";

/**
 * POST /api/permits/:id/actions
 *
 * One endpoint for every state change, so there is exactly one place that can
 * be wrong — and exactly one place the tests have to cover. The action name is
 * validated against the machine; an unknown action never reaches the database.
 */
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const auth = await requireApiUser();
  if (!auth.ok) return auth.response;

  const { id } = await context.params;
  const body = (await request.json().catch(() => null)) as
    | (ActionPayload & { acknowledgeConflict?: boolean })
    | null;
  if (!body || typeof body.action !== "string") {
    return NextResponse.json({ error: "Expected { action }." }, { status: 400 });
  }
  if (!(body.action in ACTION_LABELS)) {
    return NextResponse.json({ error: `Unknown action: ${body.action}` }, { status: 400 });
  }

  const action = body.action as PermitAction;

  if (action === "submit") {
    const result = await submitPermit(auth.user, id, {
      acknowledgeConflict: Boolean(body.acknowledgeConflict),
    });
    if (!result.ok) {
      return NextResponse.json(
        { error: result.error.message, code: result.error.code, fieldErrors: result.error.fieldErrors },
        { status: result.error.status },
      );
    }
    return NextResponse.json({ permit: result.data });
  }

  const result = await actOnPermit(auth.user, id, {
    action,
    comment: body.comment,
    notes: body.notes,
    reason: body.reason,
    hours: body.hours,
    signature: body.signature,
  });

  if (!result.ok) {
    return NextResponse.json(
      { error: result.error.message, code: result.error.code },
      { status: result.error.status },
    );
  }

  return NextResponse.json({ permit: result.data });
}
