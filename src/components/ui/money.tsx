import type { HTMLAttributes } from "react";
import { formatINR } from "@/lib/money";
import { cx } from "@/lib/utils/classes";

/** Presentation only. Signed amounts reuse Window 1's exact paise formatter. */
export function Money({ paise, showPositive = false, size = "body", className, ...props }: HTMLAttributes<HTMLSpanElement> & { paise: number; showPositive?: boolean; size?: "body" | "medium" | "large" }) {
  const sign = paise < 0 ? "-" : showPositive && paise > 0 ? "+" : "";
  return <span {...props} className={cx("money", `money--${size}`, className)}>{sign}{formatINR(Math.abs(paise))}</span>;
}
