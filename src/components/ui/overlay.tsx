"use client";

import * as Dialog from "@radix-ui/react-dialog";
import * as AlertDialog from "@radix-ui/react-alert-dialog";
import { motion, useReducedMotion } from "motion/react";
import { X } from "lucide-react";
import { useRef, type ReactNode } from "react";
import { Button, IconButton } from "./button";
import { calmVariants, drawerEnter, modalEnter, sheetEnter, springSheet } from "@/lib/ui/motion";

type OverlayProps = {
  trigger: ReactNode;
  title: string;
  description: string;
  children: ReactNode;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
};
function Overlay({ kind, trigger, title, description, children, open, onOpenChange }: OverlayProps & { kind: "modal" | "sheet" | "drawer" }) {
  const reduced = useReducedMotion();
  const heading = useRef<HTMLHeadingElement>(null);
  const variants = kind === "sheet" ? sheetEnter : kind === "drawer" ? drawerEnter : modalEnter;
  return <Dialog.Root open={open} onOpenChange={onOpenChange}>
    <Dialog.Trigger asChild>{trigger}</Dialog.Trigger>
    <Dialog.Portal>
      <Dialog.Overlay className="overlay-backdrop" />
      <Dialog.Content asChild onOpenAutoFocus={event => { event.preventDefault(); heading.current?.focus(); }}>
        <motion.section className={`overlay-surface overlay-surface--${kind}`} variants={calmVariants(variants, reduced)} initial="hidden" animate="visible" transition={kind === "modal" || reduced ? undefined : springSheet}>
          <div className="overlay-heading"><div><Dialog.Title ref={heading} tabIndex={-1} className="type-section-title">{title}</Dialog.Title><Dialog.Description className="type-body-small text-secondary">{description}</Dialog.Description></div><Dialog.Close asChild><IconButton label="Close"><X aria-hidden="true" /></IconButton></Dialog.Close></div>
          <div className="overlay-body">{children}</div>
        </motion.section>
      </Dialog.Content>
    </Dialog.Portal>
  </Dialog.Root>;
}
export function Modal(props: OverlayProps) { return <Overlay {...props} kind="modal" />; }
export function BottomSheet(props: OverlayProps) { return <Overlay {...props} kind="sheet" />; }
export function Drawer(props: OverlayProps) { return <Overlay {...props} kind="drawer" />; }

/** Caller owns pending/error state and only closes after its operation succeeds. */
export function ConfirmationDialog({ trigger, title, description, confirmLabel = "Confirm", destructive = false, loading = false, open, onOpenChange, onConfirm }: Omit<OverlayProps, "children"> & { confirmLabel?: string; destructive?: boolean; loading?: boolean; onConfirm: () => void }) {
  const reduced = useReducedMotion();
  return <AlertDialog.Root open={open} onOpenChange={onOpenChange}>
    <AlertDialog.Trigger asChild>{trigger}</AlertDialog.Trigger>
    <AlertDialog.Portal><AlertDialog.Overlay className="overlay-backdrop" />
      <AlertDialog.Content asChild onEscapeKeyDown={event => { if (loading) event.preventDefault(); }}>
        <motion.section className="overlay-surface overlay-surface--modal" variants={calmVariants(modalEnter, reduced)} initial="hidden" animate="visible">
          <div className="stack"><AlertDialog.Title className="type-section-title">{title}</AlertDialog.Title><AlertDialog.Description className="text-secondary">{description}</AlertDialog.Description><div className="overlay-actions"><AlertDialog.Cancel asChild><Button variant="secondary" disabled={loading}>Cancel</Button></AlertDialog.Cancel><Button variant={destructive ? "danger" : "primary"} loading={loading} onClick={onConfirm}>{confirmLabel}</Button></div></div>
        </motion.section>
      </AlertDialog.Content>
    </AlertDialog.Portal>
  </AlertDialog.Root>;
}
