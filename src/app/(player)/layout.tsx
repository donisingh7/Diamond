import { redirect } from "next/navigation";
import type { ReactNode } from "react";
import { getCurrentUser } from "@/lib/auth/session";
import { PlayerAccount } from "@/components/player/player-account";

/** Server-authoritative guard: an unauthenticated visitor goes to /login, an authenticated ADMIN goes to /admin. */
export default async function PlayerAreaLayout({ children }: { children: ReactNode }) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (user.role !== "PLAYER") redirect("/admin");

  return (
    <PlayerAccount name={user.name}>{children}</PlayerAccount>
  );
}
