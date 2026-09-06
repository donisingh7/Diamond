"use client";

import * as Primitive from "@radix-ui/react-tabs";
import { LayoutGroup, motion, useReducedMotion } from "motion/react";
import { useId, useState, type ReactNode } from "react";
import { baseTransition } from "@/lib/ui/motion";

export type TabOption = { value: string; label: string; content: ReactNode; disabled?: boolean };
export function Tabs({ label, items, defaultValue, value, onValueChange }: { label: string; items: TabOption[]; defaultValue?: string; value?: string; onValueChange?: (value: string) => void }) {
  const [internal, setInternal] = useState(defaultValue ?? items.find(item => !item.disabled)?.value);
  const active = value ?? internal;
  const id = useId();
  const reduced = useReducedMotion();
  return <LayoutGroup id={id}><Primitive.Root value={active} onValueChange={next => { setInternal(next); onValueChange?.(next); }}>
    <Primitive.List className="tabs-list" aria-label={label}>{items.map(item => <Primitive.Trigger key={item.value} value={item.value} disabled={item.disabled} className="tab-trigger">{active === item.value && <motion.span className="tab-indicator" layoutId={reduced ? undefined : "active-tab"} transition={baseTransition} />}<span className="tab-label">{item.label}</span></Primitive.Trigger>)}</Primitive.List>
    {items.map(item => <Primitive.Content key={item.value} value={item.value} className="tab-content">{item.content}</Primitive.Content>)}
  </Primitive.Root></LayoutGroup>;
}
