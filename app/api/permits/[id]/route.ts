import { NextResponse } from "next/server";
import { requireApiUser } from "@/lib/guard";
import { getApprovals, getAudit, getPermit } from "@/lib/permits/repo";

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const auth = await requireApiUser();
  if (!auth.ok) return auth.response;

  const { id } = await context.params;
  const permit = await getPermit(id);
  if (!permit) return NextResponse.json({ error: "Permit not found." }, { status: 404 });

  const canView =
    auth.user.role === "ADMIN" ||
    auth.user.role === "SAFETY_OFFICER" ||
    permit.requester_id === auth.user.id ||
    (auth.user.role === "AREA_OWNER" && permit.area_id === auth.user.areaId);
  if (!canView) return NextResponse.json({ error: "Permit not found." }, { status: 404 });

  const [approvals, audit] = await Promise.all([getApprovals(id), getAudit(id)]);
  return NextResponse.json({ permit, approvals, audit });
}
