import type { HTMLAttributes } from "react";
import { cx } from "@/lib/utils/classes";

type SurfaceProps = HTMLAttributes<HTMLDivElement> & { variant?: "subtle" | "default" | "strong" | "interactive" };
export function GlassSurface({ variant = "default", className, ...props }: SurfaceProps) {
  return <div className={cx("glass", `glass--${variant}`, className)} {...props} />;
}
export function GlassCard({ className, ...props }: SurfaceProps) {
  return <GlassSurface className={cx("glass-card", className)} {...props} />;
}
export function GlassPanel({ className, ...props }: SurfaceProps) {
  return <GlassSurface className={cx("glass-panel", className)} {...props} />;
}
export function TicketSurface({ children, className, ...props }: HTMLAttributes<HTMLElement>) {
  return <article className={cx("ticket", className)} {...props}><div className="ticket-content">{children}</div><div className="ticket-edge" aria-hidden="true" /></article>;
}
export function TicketSection({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cx("ticket-section", className)} {...props} />;
}
