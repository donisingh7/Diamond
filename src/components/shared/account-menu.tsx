"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { LogOut } from "lucide-react";
import { ProfileMenu } from "./navigation";

/** Real logout wiring for the shell profile slot: revoke the DB session, clear the cookie, then leave the protected area. */
export function AccountMenu({ name, redirectTo }: { name: string; redirectTo: string }) {
  const router = useRouter();
  const [loggingOut, setLoggingOut] = useState(false);

  async function handleLogout() {
    if (loggingOut) return;
    setLoggingOut(true);
    try {
      await fetch("/api/auth/logout", { method: "POST" });
    } finally {
      router.push(redirectTo);
      router.refresh();
    }
  }

  return (
    <ProfileMenu
      name={name}
      items={[{ label: loggingOut ? "Signing out…" : "Logout", icon: LogOut, onSelect: handleLogout, disabled: loggingOut }]}
    />
  );
}
