import { BetDetail } from "@/components/player/bet-detail";

export const metadata = { title: "Bet detail · Diamond" };
export default async function BetDetailPage({ params }: { params: Promise<{ reference: string }> }) {
  const { reference } = await params;
  return <BetDetail reference={reference} />;
}
