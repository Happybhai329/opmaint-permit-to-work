"use client";

import { useEffect, useState } from "react";

function format(ms: number): string {
  const past = ms <= 0;
  const total = Math.abs(ms);
  const hours = Math.floor(total / 3_600_000);
  const minutes = Math.floor((total % 3_600_000) / 60_000);
  const seconds = Math.floor((total % 60_000) / 1000);
  const body = hours > 0 ? `${hours}h ${String(minutes).padStart(2, "0")}m` : `${minutes}m ${String(seconds).padStart(2, "0")}s`;
  return past ? `${body} ago` : `${body} left`;
}

/**
 * The clock the safety officer actually watches. Rendered from the server's
 * planned_end so it never drifts with a client clock, and refreshed every
 * second only while the permit is open.
 */
export default function Countdown({
  endIso,
  className,
  prefix,
}: {
  endIso: string;
  className?: string;
  prefix?: string;
}) {
  const end = new Date(endIso).getTime();
  const [label, setLabel] = useState(() => format(end - Date.now()));
  const [urgent, setUrgent] = useState(() => end - Date.now() < 30 * 60_000);

  useEffect(() => {
    const tick = () => {
      const remaining = end - Date.now();
      setLabel(format(remaining));
      setUrgent(remaining < 30 * 60_000);
    };
    tick();
    const timer = setInterval(tick, 1000);
    return () => clearInterval(timer);
  }, [end]);

  return (
    <span
      className={className}
      style={{ fontVariantNumeric: "tabular-nums", color: urgent ? "var(--red)" : undefined, fontWeight: urgent ? 650 : undefined }}
      suppressHydrationWarning
    >
      {prefix ? `${prefix} ` : ""}
      {label}
    </span>
  );
}
