"use client";

import { useEffect, useState } from "react";
import { cx } from "@/lib/utils/classes";

export function formatCountdown(target: number, now: number) {
  if (!Number.isFinite(target) || !Number.isFinite(now)) return "-- : -- : --";
  const seconds = Math.max(0, Math.ceil((target - now) / 1000));
  return [Math.floor(seconds / 3600), Math.floor(seconds / 60) % 60, seconds % 60].map(value => String(value).padStart(2, "0")).join(" : ");
}
/** A caller-supplied instant; never decides server market status or eligibility. */
export function Countdown({ target, compact = false, label = "Time remaining" }: { target: string | Date; compact?: boolean; label?: string }) {
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    const tick = () => setNow(Date.now());
    const first = setTimeout(tick, 0);
    const timer = setInterval(tick, 1000);
    return () => { clearTimeout(first); clearInterval(timer); };
  }, []);
  const formatted = now === null ? "-- : -- : --" : formatCountdown(new Date(target).getTime(), now);
  return <span className={cx("countdown", compact && "countdown--compact")} role="timer" aria-label={`${label}: ${formatted}`} aria-live="off">{formatted}</span>;
}
