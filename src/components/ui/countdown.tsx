"use client";

import { useEffect, useState } from "react";
import { cx } from "@/lib/utils/classes";

export function formatCountdown(target: number, now: number) {
  if (!Number.isFinite(target) || !Number.isFinite(now)) return "-- : -- : --";
  const seconds = Math.max(0, Math.ceil((target - now) / 1000));
  return [Math.floor(seconds / 3600), Math.floor(seconds / 60) % 60, seconds % 60].map(value => String(value).padStart(2, "0")).join(" : ");
}
/** A caller-supplied instant; never decides server market status or eligibility. */
export function Countdown({ target, compact = false, label = "Time remaining", serverNow, receivedAt }: { target: string | Date; compact?: boolean; label?: string; serverNow?: string; receivedAt?: number }) {
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    // Monotonic elapsed time corrects browser clock skew without deciding eligibility.
    const tick = () => setNow(serverNow && receivedAt !== undefined ? new Date(serverNow).getTime() + Math.max(0, performance.now() - receivedAt) : Date.now());
    const first = setTimeout(tick, 0);
    const timer = setInterval(tick, 1000);
    return () => { clearTimeout(first); clearInterval(timer); };
  }, [serverNow, receivedAt]);
  const formatted = now === null ? "-- : -- : --" : formatCountdown(new Date(target).getTime(), now);
  return <span className={cx("countdown", compact && "countdown--compact")} role="timer" aria-label={`${label}: ${formatted}`} aria-live="off">{formatted}</span>;
}
