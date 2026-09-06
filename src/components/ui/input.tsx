"use client";

import { useId, useState, type InputHTMLAttributes, type ReactNode } from "react";
import { Eye, EyeOff } from "lucide-react";
import { IconButton } from "./button";
import { cx } from "@/lib/utils/classes";

export type InputProps = InputHTMLAttributes<HTMLInputElement> & { label: string; helperText?: string; error?: string; leadingIcon?: ReactNode; trailingIcon?: ReactNode };
export function Input({ id, label, helperText, error, leadingIcon, trailingIcon, className, "aria-describedby": describedBy, ...props }: InputProps) {
  const generatedId = useId();
  const inputId = id ?? generatedId;
  const description = [describedBy, helperText ? `${inputId}-help` : undefined, error ? `${inputId}-error` : undefined].filter(Boolean).join(" ") || undefined;
  return <div className={cx("field", className)}>
    <label className="type-label" htmlFor={inputId}>{label}</label>
    <div className={cx("input-wrap", error && "input-wrap--error", props.disabled && "input-wrap--disabled")}>
      {leadingIcon && <span className="input-icon" aria-hidden="true">{leadingIcon}</span>}
      <input {...props} id={inputId} aria-invalid={error ? true : props["aria-invalid"]} aria-describedby={description} />
      {trailingIcon && <span className="input-trailing">{trailingIcon}</span>}
    </div>
    {helperText && <p className="type-caption text-secondary" id={`${inputId}-help`}>{helperText}</p>}
    {error && <p className="type-caption text-danger" id={`${inputId}-error`}>{error}</p>}
  </div>;
}
export function PasswordInput(props: Omit<InputProps, "type" | "trailingIcon">) {
  const [visible, setVisible] = useState(false);
  return <Input {...props} type={visible ? "text" : "password"} trailingIcon={<IconButton label={visible ? "Hide password" : "Show password"} disabled={props.disabled} aria-pressed={visible} onClick={() => setVisible(!visible)}>{visible ? <EyeOff aria-hidden="true" /> : <Eye aria-hidden="true" />}</IconButton>} />;
}
/** Inert visual specimen. OTP entry, delivery and validation belong to Window 2B. */
export function OtpPreview() {
  return <div className="otp-preview" role="img" aria-label="Six-digit verification code appearance"><span aria-hidden="true">—</span><span aria-hidden="true">—</span><span aria-hidden="true">—</span><span aria-hidden="true">—</span><span aria-hidden="true">—</span><span aria-hidden="true">—</span></div>;
}
