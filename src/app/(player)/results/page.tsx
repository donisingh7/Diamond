import { Suspense } from "react";
import { ResultsScreen } from "@/components/player/results-screen";
import { PageSkeleton } from "@/components/ui/feedback";

export const metadata = { title: "Results · Diamond" };
export default function ResultsPage() { return <Suspense fallback={<PageSkeleton />}><ResultsScreen /></Suspense>; }
