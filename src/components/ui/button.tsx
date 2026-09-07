"use client";

import { motion, useReducedMotion, type HTMLMotionProps } from "motion/react";
import type { ReactNode } from "react";
import { LoaderCircle } from "lucide-react";
import { springInteractive } from "@/lib/ui/motion";
import { cx } from "@/lib/utils/classes";

export type ButtonProps = Omit<HTMLMotionProps<"button">, "children"> & {
  variant?: "primary" | "secondary" | "ghost" | "danger";
  size?: "sm" | "md" | "lg";
  loading?: boolean;
  leadingIcon?: ReactNode;
  trailingIcon?: ReactNode;
  children?: ReactNode;
};
export function Button({ variant = "primary", size = "md", loading = false, disabled, leadingIcon, trailingIcon, children, className, ...props }: ButtonProps) {
  const reduced = useReducedMotion();
  // Motion auto-adds tabIndex for tap gestures. Keep it stable when reduced motion removes the gesture during hydration.
  return <motion.button type="button" {...props} tabIndex={props.tabIndex ?? 0} className={cx("button", `button--${variant}`, `button--${size}`, className)} disabled={disabled || loading} aria-busy={loading || undefined} whileTap={reduced || disabled || loading ? undefined : { scale: 0.98 }} transition={springInteractive}>
    <span className={cx("button-content", loading && "button-content--loading")}>{leadingIcon}<span>{children}</span>{trailingIcon}</span>
    {loading && <span className="button-loader"><LoaderCircle className="spinner" aria-hidden="true" /><span className="sr-only">Loading</span></span>}
  </motion.button>;
}
export function IconButton({ label, children, className, ...props }: Omit<ButtonProps, "leadingIcon" | "trailingIcon"> & { label: string }) {
  return <Button variant="ghost" {...props} aria-label={label} title={label} className={cx("icon-button", className)}>{children}</Button>;
}
