"use client";

import { ThemeToggle } from "@/components/ui/theme-toggle";

import { useState, type ReactNode } from "react";
import { usePathname } from "next/navigation";
import { LayoutDashboard, UsersRound, Store, ChartNoAxesCombined, Ticket, Layers3, ArrowUpRight, ArrowDownLeft, Landmark, Gauge, ScrollText, LogOut, PanelLeftClose, PanelLeftOpen, Menu, UserRound } from "lucide-react";
import { Brand, NavItem, ProfileMenu, type NavigationItem } from "@/components/shared/navigation";
import { IconButton } from "@/components/ui/button";
import { Drawer } from "@/components/ui/overlay";

export const adminNavigation: NavigationItem[] = [
  { label: "Dashboard", href: "/admin/dashboard", icon: LayoutDashboard },
  { label: "Players", href: "/admin/players", icon: UsersRound },
  { label: "Markets", href: "/admin/markets", icon: Store },
  { label: "Results", href: "/admin/results", icon: ChartNoAxesCombined },
  { label: "Settlement", href: "/admin/settlement", icon: Layers3 },
  { label: "Bets", href: "/admin/bets", icon: Ticket },
  { label: "Withdrawals", href: "/admin/withdrawals", icon: ArrowUpRight },
  { label: "Deposits", href: "/admin/deposits", icon: ArrowDownLeft },
  { label: "Payment Methods", href: "/admin/payment-methods", icon: Landmark },
  { label: "Payout Rate", href: "/admin/game-rate", icon: Gauge },
  { label: "Audit Log", href: "/admin/audit", icon: ScrollText },
];
export function AdminShell({ children, title, breadcrumbs, search, notifications, profile, navigation = adminNavigation }: { children: ReactNode; title: string; breadcrumbs?: ReactNode; search?: ReactNode; notifications?: ReactNode; profile?: ReactNode; navigation?: NavigationItem[] }) {
  const [collapsed, setCollapsed] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const pathname = usePathname();
  const activeTitle = navigation.find(item => pathname === item.href || pathname.startsWith(`${item.href}/`))?.label ?? title;
  return <div className="admin-shell" data-collapsed={collapsed}>
    <a className="skip-link" href="#admin-content">Skip to workspace</a>
    <aside className="admin-sidebar"><div className="sidebar-brand"><span className="sidebar-brand-full"><Brand compact={collapsed} /></span><span className="sidebar-brand-compact"><Brand compact /></span></div><p className="sidebar-caption type-caption">Workspace</p><nav aria-label="Admin navigation" className="sidebar-nav">{navigation.map(item => <NavItem key={item.label} item={item} compact={collapsed} />)}</nav><div className="sidebar-footer"><IconButton label={collapsed ? "Expand sidebar" : "Collapse sidebar"} aria-expanded={!collapsed} className="sidebar-toggle" onClick={() => setCollapsed(!collapsed)}>{collapsed ? <PanelLeftOpen aria-hidden="true" /> : <PanelLeftClose aria-hidden="true" />}</IconButton></div></aside>
    <div className="admin-workspace"><header className="admin-topbar"><div className="admin-title-group"><div className="admin-mobile-menu"><Drawer open={drawerOpen} onOpenChange={setDrawerOpen} title="Diamond workspace" description="Administration navigation" trigger={<IconButton label="Open admin navigation"><Menu aria-hidden="true" /></IconButton>}><nav aria-label="Admin mobile navigation" className="sidebar-nav">{navigation.map(item => <NavItem key={item.label} item={item} onNavigate={() => setDrawerOpen(false)} />)}</nav>{profile}</Drawer></div><div>{breadcrumbs && <div className="type-caption text-muted">{breadcrumbs}</div>}<p className="type-card-title">{activeTitle}</p></div></div><div className="topbar-slots">{search}{notifications}<ThemeToggle />{profile ?? <ProfileMenu name="Admin" items={[{ label: "Profile", icon: UserRound, disabled: true }, { label: "Logout", icon: LogOut, disabled: true }]} />}</div></header><main id="admin-content" tabIndex={-1} className="admin-content">{children}</main></div>
  </div>;
}
