"use client";

import * as Primitive from "@radix-ui/react-toast";
import { createContext, useContext, useRef, useState, type ReactNode } from "react";
import { CheckCircle2, X } from "lucide-react";
import { IconButton } from "./button";
import type { Tone } from "./feedback";

type Message = { title: string; description?: string; tone?: Tone };
const ToastContext = createContext<((message: Message) => void) | null>(null);
export function ToastProvider({ children }: { children: ReactNode }) {
  const [messages, setMessages] = useState<(Message & { id: number })[]>([]);
  const sequence = useRef(0);
  function toast(message: Message) {
    const id = ++sequence.current;
    setMessages(previous => [...previous.slice(-2), { ...message, id }]);
  }
  return <ToastContext.Provider value={toast}><Primitive.Provider swipeDirection="right" duration={6000}>
    {children}
    {messages.map(message => <Primitive.Root key={message.id} className={`toast tone-${message.tone ?? "info"}`} onOpenChange={open => { if (!open) setMessages(previous => previous.filter(item => item.id !== message.id)); }}>
      <CheckCircle2 aria-hidden="true" /><div><Primitive.Title className="type-label">{message.title}</Primitive.Title>{message.description && <Primitive.Description className="type-body-small text-secondary">{message.description}</Primitive.Description>}</div><Primitive.Close asChild><IconButton label="Dismiss notification"><X aria-hidden="true" /></IconButton></Primitive.Close>
    </Primitive.Root>)}
    <Primitive.Viewport className="toast-viewport" />
  </Primitive.Provider></ToastContext.Provider>;
}
export function useToast() {
  const toast = useContext(ToastContext);
  if (!toast) throw new Error("useToast requires ToastProvider");
  return toast;
}
