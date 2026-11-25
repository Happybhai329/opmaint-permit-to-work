import Link from "next/link";
import NewPermitForm from "@/components/NewPermitForm";
import { requireUser } from "@/lib/guard";
import { listAreas, listEquipment } from "@/lib/permits/repo";

export const dynamic = "force-dynamic";

export default async function NewPermitPage() {
  const user = await requireUser();
  const [areas, equipment] = await Promise.all([listAreas(), listEquipment()]);

  const canRaise = user.role === "REQUESTER" || user.role === "ADMIN";

  return (
    <div>
      <div className="page-head">
        <div>
          <h1>Raise a permit</h1>
          <div className="sub">
            One permit, four types. The questions change; the approvals and the rules do not.
          </div>
        </div>
      </div>

      {canRaise ? (
        <NewPermitForm areas={areas} equipment={equipment} />
      ) : (
        <div className="card card-pad">
          <p style={{ marginTop: 0 }}>
            Permits are raised by requesters and site supervisors. Your role is to <strong>approve</strong>{" "}
            or <strong>verify</strong>, not to raise — which is what stops a safety officer from writing
            and signing the same permit.
          </p>
          <Link className="btn" href="/approvals">
            See what is waiting for you
          </Link>
        </div>
      )}
    </div>
  );
}
