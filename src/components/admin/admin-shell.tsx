"use client";

import { useState, type ReactNode } from "react";
import { LayoutDashboard, UsersRound, Store, ChartNoAxesCombined, Ticket, Wallet, ArrowUpRight, Gauge, ScrollText, Settings2, LogOut, PanelLeftClose, PanelLeftOpen, Menu, UserRound } from "lucide-react";
import { Brand, NavItem, ProfileMenu, type NavigationItem } from "@/components/shared/navigation";
import { IconButton, Button } from "@/components/ui/button";
import { Drawer } from "@/components/ui/overlay";

export const adminNavigation: NavigationItem[] = [
  { label: "Dashboard", href: "/admin/dashboard", icon: LayoutDashboard },
  { label: "Players", href: "/admin/players", icon: UsersRound },
  { label: "Markets", href: "/admin/markets", icon: Store },
  { label: "Results", href: "/admin/results", icon: ChartNoAxesCombined },
  { label: "Bets", href: "/admin/bets", icon: Ticket },
  { label: "Wallet", href: "/admin/wallet", icon: Wallet },
  { label: "Withdrawals", href: "/admin/withdrawals", icon: ArrowUpRight },
  { label: "Game Rate", href: "/admin/game-rate", icon: Gauge },
  { label: "Audit Log", href: "/admin/audit", icon: ScrollText },
  { label: "Settings", href: "/admin/settings", icon: Settings2 },
];
export function AdminShell({ children, title, breadcrumbs, search, notifications, profile, navigation = adminNavigation }: { children: ReactNode; title: string; breadcrumbs?: ReactNode; search?: ReactNode; notifications?: ReactNode; profile?: ReactNode; navigation?: NavigationItem[] }) {
  const [collapsed, setCollapsed] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  return <div className="admin-shell" data-collapsed={collapsed}>
    <a className="skip-link" href="#admin-content">Skip to workspace</a>
    <aside className="admin-sidebar"><div className="sidebar-brand"><span className="sidebar-brand-full"><Brand compact={collapsed} /></span><span className="sidebar-brand-compact"><Brand compact /></span></div><p className="sidebar-caption type-caption">Workspace</p><nav aria-label="Admin navigation" className="sidebar-nav">{navigation.map(item => <NavItem key={item.label} item={item} compact={collapsed} />)}</nav><div className="sidebar-footer"><Button variant="ghost" disabled leadingIcon={<LogOut aria-hidden="true" />} aria-label="Logout unavailable">{collapsed ? null : "Logout"}</Button><IconButton label={collapsed ? "Expand sidebar" : "Collapse sidebar"} aria-expanded={!collapsed} className="sidebar-toggle" onClick={() => setCollapsed(!collapsed)}>{collapsed ? <PanelLeftOpen aria-hidden="true" /> : <PanelLeftClose aria-hidden="true" />}</IconButton></div></aside>
    <div className="admin-workspace"><header className="admin-topbar"><div className="admin-title-group"><div className="admin-mobile-menu"><Drawer open={drawerOpen} onOpenChange={setDrawerOpen} title="Diamond workspace" description="Administration navigation" trigger={<IconButton label="Open admin navigation"><Menu aria-hidden="true" /></IconButton>}><nav aria-label="Admin mobile navigation" className="sidebar-nav">{navigation.map(item => <NavItem key={item.label} item={item} onNavigate={() => setDrawerOpen(false)} />)}</nav><Button variant="ghost" disabled leadingIcon={<LogOut aria-hidden="true" />}>Logout unavailable</Button></Drawer></div><div>{breadcrumbs && <div className="type-caption text-muted">{breadcrumbs}</div>}<p className="type-card-title">{title}</p></div></div><div className="topbar-slots">{search}{notifications}{profile ?? <ProfileMenu name="Admin" items={[{ label: "Profile", icon: UserRound, disabled: true }, { label: "Logout", icon: LogOut, disabled: true }]} />}</div></header><main id="admin-content" tabIndex={-1} className="admin-content">{children}</main></div>
  </div>;
}
