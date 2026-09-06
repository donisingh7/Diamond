"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import * as Menu from "@radix-ui/react-dropdown-menu";
import { Diamond, ChevronDown, UserRound, type LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { cx } from "@/lib/utils/classes";

export function Brand({ compact = false }: { compact?: boolean }) {
  return <span className="brand"><span className="brand-mark"><Diamond aria-hidden="true" /></span><span className={compact ? "sr-only" : "brand-name"}>diamond<span className="brand-period">.</span></span></span>;
}
export type NavigationItem = { label: string; href: string; icon: LucideIcon; exact?: boolean };
export function isRouteActive(pathname: string, href: string, exact = false) {
  return pathname === href || (!exact && href !== "/" && pathname.startsWith(`${href}/`));
}
export function NavItem({ item, active, mobile = false, compact = false, prominent = false, onNavigate }: { item: NavigationItem; active?: boolean; mobile?: boolean; compact?: boolean; prominent?: boolean; onNavigate?: () => void }) {
  const pathname = usePathname();
  const selected = active ?? isRouteActive(pathname, item.href, item.exact);
  const Icon = item.icon;
  return <Link href={item.href} prefetch={false} aria-current={selected ? "page" : undefined} title={compact ? item.label : undefined} onClick={onNavigate} className={cx("nav-item", selected && "nav-item--active", mobile && "nav-item--mobile", compact && "nav-item--compact", prominent && "nav-item--prominent")}><Icon aria-hidden="true" /><span className={compact ? "sr-only" : undefined}>{item.label}</span></Link>;
}
export type ProfileMenuItem = { label: string; icon: LucideIcon; onSelect?: () => void; href?: string; danger?: boolean; disabled?: boolean };
export function ProfileMenu({ label = "Profile menu", name = "Account", items, avatar }: { label?: string; name?: string; items: ProfileMenuItem[]; avatar?: ReactNode }) {
  return <Menu.Root><Menu.Trigger asChild><Button variant="ghost" className="profile-trigger" aria-label={label}><span className="avatar">{avatar ?? <UserRound aria-hidden="true" />}</span><span className="profile-name">{name}</span><ChevronDown aria-hidden="true" /></Button></Menu.Trigger><Menu.Portal><Menu.Content className="profile-menu" sideOffset={10} align="end" collisionPadding={12}><Menu.Label className="menu-label">{name}</Menu.Label><Menu.Separator className="menu-separator" />{items.map(item => <Menu.Item key={item.label} className={cx("menu-item", item.danger && "text-danger")} disabled={item.disabled} onSelect={item.onSelect} asChild={Boolean(item.href)}>{item.href ? <Link href={item.href}><item.icon aria-hidden="true" />{item.label}</Link> : <><item.icon aria-hidden="true" />{item.label}</>}</Menu.Item>)}</Menu.Content></Menu.Portal></Menu.Root>;
}
