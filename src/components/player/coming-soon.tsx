import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { GlassPanel } from "@/components/ui/surface";

/** Honest navigation destinations for later windows, without simulated account features. */
export function ComingSoon({ title, description }: { title: string; description: string }) {
  return <div className="player-page"><div className="page-intro"><p className="eyebrow">Your Diamond account</p><h1 className="type-display">{title}</h1></div><GlassPanel className="stack"><h2 className="type-section-title">Coming in a future release</h2><p className="text-secondary">{description}</p><Link className="text-link" href="/markets">Explore markets <ArrowRight aria-hidden="true" /></Link></GlassPanel></div>;
}
