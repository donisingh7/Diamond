import { notFound } from "next/navigation";
import { AdminOverview, AdminAudit, AdminRate } from "@/components/admin/admin-summary";
import { AdminPlayers, AdminPlayer } from "@/components/admin/admin-players";
import { AdminBets, AdminBet } from "@/components/admin/admin-bets";
import { AdminWithdrawals, AdminWithdrawal, AdminPlayerWithdrawals } from "@/components/admin/admin-withdrawals";
import { AdminMarkets, AdminResults, AdminSettlement } from "@/components/admin/admin-markets";
import { AdminPaymentMethods } from "@/components/admin/admin-payment-methods";
import { AdminDeposits, AdminDepositDetail } from "@/components/admin/admin-deposits";

export const metadata = { title: "Admin operations · Diamond" };
export default async function AdminSectionPage({ params }: { params: Promise<{ section: string[] }> }) {
  const { section } = await params;
  const [area, id, detail] = section;
  if (section.length === 1) {
    switch (area) {
      case "dashboard": return <AdminOverview />;
      case "players": return <AdminPlayers />;
      case "bets": return <AdminBets />;
      case "withdrawals": return <AdminWithdrawals />;
      case "deposits": return <AdminDeposits />;
      case "payment-methods": return <AdminPaymentMethods />;
      case "markets": return <AdminMarkets />;
      case "results": return <AdminResults />;
      case "settlement": return <AdminSettlement />;
      case "game-rate": return <AdminRate />;
      case "audit": return <AdminAudit />;
    }
  }
  if (section.length === 2 && id) {
    if (area === "players") return <AdminPlayer key={id} id={id} />;
    if (area === "bets") return <AdminBet key={id} reference={id} />;
    if (area === "withdrawals") return <AdminWithdrawal key={id} id={id} />;
    if (area === "deposits") return <AdminDepositDetail key={id} id={id} />;
    if (area === "results") return <AdminResults key={id} initialMarket={id} />;
  }
  if (section.length === 3 && id && detail) {
    if (area === "players" && detail === "bets") return <AdminBets key={id} playerId={id} />;
    if (area === "players" && detail === "withdrawals") return <AdminPlayerWithdrawals key={id} id={id} />;
    if (area === "settlement") return <AdminSettlement key={`${id}-${detail}`} initialMarket={id} initialDate={detail} />;
  }
  notFound();
}
