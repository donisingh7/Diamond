import { Layers3 } from "lucide-react";
import { getCurrentUser } from "@/lib/auth/session";
import { GlassCard } from "@/components/ui/surface";
import { EmptyState } from "@/components/ui/feedback";

export const metadata = { title: "Diamond" };

/** Smallest legitimate authenticated landing to prove auth works; Window 3 builds the real Home. */
export default async function PlayerHomePage() {
  const user = await getCurrentUser();
  return (
    <div className="stack-lg">
      <div className="page-intro">
        <p className="eyebrow">Your space</p>
        <h1 className="type-display">Welcome back, {user?.name ?? "there"}<span className="text-accent">.</span></h1>
        <p className="text-secondary">Markets, results and your bets will appear here in a future release.</p>
      </div>
      <GlassCard variant="strong">
        <EmptyState
          icon={<Layers3 aria-hidden="true" />}
          title="Home is on its way"
          description="You're signed in. The full player home arrives in a later window."
        />
      </GlassCard>
    </div>
  );
}
