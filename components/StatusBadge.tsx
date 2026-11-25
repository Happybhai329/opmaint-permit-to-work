import { STATUS_LABELS, STATUS_TONE, type PermitStatus } from "@/lib/permits/state";

export default function StatusBadge({
  status,
  live = false,
}: {
  status: PermitStatus;
  live?: boolean;
}) {
  return (
    <span className="badge" data-tone={STATUS_TONE[status]}>
      {live ? <span className="dot pulse" aria-hidden /> : null}
      {STATUS_LABELS[status]}
    </span>
  );
}
