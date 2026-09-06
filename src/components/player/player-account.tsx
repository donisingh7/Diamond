"use client";

import { createContext, useContext, type ReactNode } from "react";
import type { WalletView } from "@/modules/wallet/services/wallet.service";
import { usePlayerApi } from "@/lib/ui/use-player-api";
import { PlayerShell } from "./player-shell";
import { AccountMenu } from "@/components/shared/account-menu";
import { Money } from "@/components/ui/money";

type WalletResponse = { wallet: WalletView; serverNow: string };
const WalletContext = createContext<ReturnType<typeof usePlayerApi<WalletResponse>> | null>(null);

export function PlayerAccount({ name, children }: { name: string; children: ReactNode }) {
  const wallet = usePlayerApi<WalletResponse>("/api/wallet");
  return <WalletContext.Provider value={wallet}><PlayerShell
    profile={<AccountMenu name={name} redirectTo="/login" />}
    balance={<><span className="type-caption text-muted">Available</span>{wallet.data ? <Money paise={wallet.data.wallet.availableBalancePaise} /> : <span className="type-caption" title={wallet.error}>{wallet.error ? "Unavailable" : "Loading…"}</span>}</>}
  >{children}</PlayerShell></WalletContext.Provider>;
}

export function usePlayerWallet() {
  const wallet = useContext(WalletContext);
  if (!wallet) throw new Error("usePlayerWallet requires PlayerAccount");
  return wallet;
}
