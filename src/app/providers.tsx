"use client";

import { MotionConfig } from "motion/react";
import { baseTransition } from "@/lib/ui/motion";
import { ToastProvider } from "@/components/ui/toast";

export function Providers({ children }: { children: React.ReactNode }) {
  return <MotionConfig reducedMotion="user" transition={baseTransition}><ToastProvider>{children}</ToastProvider></MotionConfig>;
}
