import { MarketDetail } from "@/components/player/market-screens";

export const metadata = { title: "Market overview · Diamond" };
export default async function MarketPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  return <MarketDetail slug={slug} />;
}
