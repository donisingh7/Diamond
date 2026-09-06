"use client";
import { Button, type ButtonProps } from "./button";
import { cx } from "@/lib/utils/classes";

export function NumberTile({ value, selected = false, className, ...props }: Omit<ButtonProps, "children"> & { value: string; selected?: boolean }) {
  return <Button variant="secondary" {...props} aria-pressed={selected} className={cx("number-tile", selected && "number-tile--selected", className)}>{value}</Button>;
}
