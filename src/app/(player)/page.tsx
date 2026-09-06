import { getCurrentUser } from "@/lib/auth/session";
import { PlayerHome } from "@/components/player/market-screens";

export const metadata = { title: "Home · Diamond" };

export default async function PlayerHomePage() {
  const user = await getCurrentUser();
  return <PlayerHome name={user?.name ?? "there"} />;
}
