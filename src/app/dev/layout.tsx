import { notFound } from "next/navigation";
import type { ReactNode } from "react";

export const metadata = { title: "Design studio · Diamond", robots: { index: false, follow: false } };
export default function DevelopmentLayout({ children }: { children: ReactNode }) {
  if (process.env.NODE_ENV !== "development") notFound();
  return children;
}
