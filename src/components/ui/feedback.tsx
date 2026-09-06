import type { HTMLAttributes, ReactNode } from "react";
import { CircleAlert, Inbox, Info } from "lucide-react";
import { cx } from "@/lib/utils/classes";
import { GlassCard } from "./surface";

export type Tone = "neutral" | "success" | "warning" | "danger" | "info";
export function Badge({ tone = "neutral", className, ...props }: HTMLAttributes<HTMLSpanElement> & { tone?: Tone }) {
  return <span className={cx("badge", `tone-${tone}`, className)} {...props} />;
}
export function Alert({ title, children, tone = "info", ...props }: HTMLAttributes<HTMLDivElement> & { title: string; tone?: Tone }) {
  return <div {...props} className={cx("alert", `tone-${tone}`, props.className)} role={tone === "danger" ? "alert" : "status"}><Info aria-hidden="true" /><div><p className="type-label">{title}</p>{children && <div className="type-body-small text-secondary">{children}</div>}</div></div>;
}
type StateProps = { icon?: ReactNode; title: string; description?: string; action?: ReactNode };
export function EmptyState({ icon = <Inbox />, title, description, action }: StateProps) {
  return <div className="empty-state"><span className="state-icon" aria-hidden="true">{icon}</span><h3 className="type-card-title">{title}</h3>{description && <p className="text-secondary type-body-small">{description}</p>}{action}</div>;
}
export function ErrorState({ title = "Something went wrong", ...props }: Partial<StateProps>) {
  return <div role="alert"><EmptyState title={title} icon={<CircleAlert />} {...props} /></div>;
}
export function Skeleton({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div {...props} aria-hidden="true" className={cx("skeleton", className)} />;
}
export function CardSkeleton() {
  return <GlassCard role="status" aria-label="Loading content"><div className="stack"><Skeleton className="skeleton-label" /><Skeleton className="skeleton-heading" /><Skeleton /><Skeleton className="skeleton-short" /></div></GlassCard>;
}
export function PageSkeleton() {
  return <div className="stack" role="status" aria-label="Loading page"><Skeleton className="skeleton-heading" /><div className="two-column"><CardSkeleton /><CardSkeleton /></div></div>;
}
