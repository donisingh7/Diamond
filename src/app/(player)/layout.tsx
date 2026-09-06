import { redirect } from "next/navigation";
import type { ReactNode } from "react";
import { getCurrentUser } from "@/lib/auth/session";
import { PlayerShell } from "@/components/player/player-shell";
import { AccountMenu } from "@/components/shared/account-menu";

/** Server-authoritative guard: an unauthenticated visitor goes to /login, an authenticated ADMIN goes to /admin. */
export default async function PlayerAreaLayout({ children }: { children: ReactNode }) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (user.role !== "PLAYER") redirect("/admin");

  return (
    <PlayerShell
      profile={<AccountMenu name={user.name} redirectTo="/login" />}
      balance={<><span className="type-caption text-muted">Balance</span><span className="numeric-medium">—</span></>}
    >
      {children}
    </PlayerShell>
  );
}
