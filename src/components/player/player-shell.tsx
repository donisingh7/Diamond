"use client";

import { ThemeToggle } from "@/components/ui/theme-toggle";

import { House, ChartNoAxesCombined, Ticket, Wallet, Grid2X2, UserRound, CircleHelp, Headphones, LogOut, Gauge } from "lucide-react";
import type { ReactNode } from "react";
import Link from "next/link";
import { Brand, NavItem, ProfileMenu, type NavigationItem } from "@/components/shared/navigation";

export const playerNavigation: NavigationItem[] = [
  { label: "Home", href: "/", icon: House, exact: true },
  { label: "Results", href: "/results", icon: ChartNoAxesCombined },
  { label: "Play", href: "/markets", icon: Grid2X2 },
  { label: "My Bets", href: "/my-bets", icon: Ticket },
  { label: "Wallet", href: "/wallet", icon: Wallet },
];
export function PlayerShell({ children, balance, profile, navigation = playerNavigation }: { children: ReactNode; balance?: ReactNode; profile?: ReactNode; navigation?: NavigationItem[] }) {
  return <div className="player-shell">
    <a className="skip-link" href="#player-content">Skip to content</a>
    <header className="player-header app-container"><Link href={navigation[0]?.href ?? "/"} aria-label="Diamond home"><Brand /></Link><nav className="player-desktop-nav" aria-label="Player navigation">{navigation.filter(item => item.label !== "Play").map(item => <NavItem key={item.label} item={item} />)}</nav><div className="header-account"><ThemeToggle />{balance && <div className="balance-slot">{balance}</div>}{profile ?? <ProfileMenu items={[
      { label: "Profile", icon: UserRound, disabled: true }, { label: "Game Rate", icon: Gauge, disabled: true }, { label: "How To Play", icon: CircleHelp, disabled: true }, { label: "Support", icon: Headphones, disabled: true }, { label: "Logout", icon: LogOut, disabled: true },
    ]} />}</div></header>
    <main id="player-content" tabIndex={-1} className="player-content app-container">{children}</main>
    <nav className="player-bottom-nav" aria-label="Player mobile navigation">{navigation.map(item => <NavItem key={item.label} item={item} mobile prominent={item.label === "Play"} />)}</nav>
  </div>;
}
