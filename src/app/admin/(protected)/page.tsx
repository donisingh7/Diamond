import { Layers3 } from "lucide-react";
import { getCurrentUser } from "@/lib/auth/session";
import { GlassCard } from "@/components/ui/surface";
import { EmptyState } from "@/components/ui/feedback";

export const metadata = { title: "Admin · Diamond" };

/** Smallest legitimate authenticated landing to prove admin auth/route protection works; Window 6 builds the real dashboard. */
export default async function AdminDashboardPage() {
  const user = await getCurrentUser();
  return (
    <div className="stack-lg">
      <div className="page-intro">
        <p className="eyebrow">Diamond workspace</p>
        <h1 className="type-display">Welcome, {user?.name ?? "Administrator"}<span className="text-accent">.</span></h1>
        <p className="text-secondary">Player, market and operations tooling arrives in a later window.</p>
      </div>
      <GlassCard variant="strong">
        <EmptyState
          icon={<Layers3 aria-hidden="true" />}
          title="Dashboard is on its way"
          description="You're signed in as an administrator. The full admin panel arrives in a later window."
        />
      </GlassCard>
    </div>
  );
}
