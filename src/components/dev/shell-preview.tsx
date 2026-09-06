"use client";

import Link from "next/link";
import { ArrowUpRight, Layers3, UserRound, Gauge, CircleHelp, Headphones, LogOut } from "lucide-react";
import { PlayerShell, playerNavigation } from "@/components/player/player-shell";
import { AdminShell, adminNavigation } from "@/components/admin/admin-shell";
import { GlassCard } from "@/components/ui/surface";
import { CardSkeleton, Badge, EmptyState } from "@/components/ui/feedback";
import { Money } from "@/components/ui/money";
import { ProfileMenu } from "@/components/shared/navigation";
import { useToast } from "@/components/ui/toast";

export function ShellPreview({ admin = false, section }: { admin?: boolean; section: string }) {
  const toast = useToast();
  const navigation = admin ? adminNavigation.map(item => ({ ...item, href: item.href.replace("/admin", "/dev/admin") })) : playerNavigation.map(item => ({ ...item, href: `/dev/player/${item.href === "/" ? "home" : item.href.slice(1)}` }));
  const title = navigation.find(item => item.href.endsWith(`/${section}`))?.label ?? "Shell preview";
  const profile = <ProfileMenu name={admin ? "Admin preview" : "Player preview"} items={[{ label: "Profile", icon: UserRound }, ...admin ? [] : [{ label: "Game Rate", icon: Gauge }, { label: "How To Play", icon: CircleHelp }, { label: "Support", icon: Headphones }], { label: "Logout", icon: LogOut }].map(item => ({ ...item, onSelect: () => toast({ title: `${item.label} preview`, description: "Navigation demonstration only. No account action was performed." }) }))} />;
  const content = <div className="stack-lg"><div className="preview-bar"><Badge>Shell preview</Badge><Link className="text-link" href="/dev/design-system">Design studio <ArrowUpRight aria-hidden="true" /></Link></div><div className="page-intro"><p className="eyebrow">{admin ? "Diamond workspace" : "Your space"}</p><h1 className="type-display">{title}<span className="text-accent">.</span></h1><p className="text-secondary">A home for what comes next.</p></div><GlassCard variant="strong"><EmptyState icon={<Layers3 />} title={`${title} workspace`} description="This preview demonstrates navigation and layout. Feature content will arrive in a later window." /></GlassCard><div className="two-column"><CardSkeleton /><CardSkeleton /></div><p className="type-caption text-muted">Development preview · No live account, market or financial data.</p></div>;
  return admin ? <AdminShell title={title} breadcrumbs="Diamond / Preview" navigation={navigation} profile={profile}>{content}</AdminShell> : <PlayerShell navigation={navigation} profile={profile} balance={<><span className="type-caption text-muted">Sample balance</span><Money paise={842000} /></>}>{content}</PlayerShell>;
}
