import type { BetCompositionDTO, BetSelectionDTO, PlayerBetDTO } from "@/modules/betting/services/bet-read.service";
import { Badge } from "@/components/ui/feedback";
import { Money } from "@/components/ui/money";

export function methodLabel(bet: Pick<BetCompositionDTO, "entryMethod" | "entryMetadata">) {
  return `${bet.entryMethod === "COPY_PASTE" ? "Copy Paste" : bet.entryMethod === "CROSSING" ? "Crossing" : bet.entryMethod === "JODI" ? "Jodi" : bet.entryMethod}${bet.entryMetadata.palti === true ? " · Palti" : ""}`;
}

export function BetTime({ value }: { value: string }) {
  return <time dateTime={value}>{new Intl.DateTimeFormat("en-IN", { timeZone: "Asia/Kolkata", day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", hour12: true }).format(new Date(value))} IST</time>;
}

export function BetStatus({ status }: { status: string }) {
  return <Badge tone={status === "WON" ? "success" : status === "ACTIVE" ? "info" : "neutral"}>{status === "ACTIVE" ? "Active" : status === "WON" ? "Won" : status === "LOST" ? "Lost" : status}</Badge>;
}

export function BetOutcome({ bet }: { bet: PlayerBetDTO }) {
  return <>{bet.result !== null && <div><dt>Market result</dt><dd>{bet.result}</dd></div>}{bet.winningNumber !== null && <div><dt>Winning number</dt><dd>{bet.winningNumber}</dd></div>}{bet.payoutPaise !== null && <div><dt>Payout</dt><dd><Money paise={bet.payoutPaise} /></dd></div>}</>;
}

export function Selections({ selections }: { selections: BetSelectionDTO[] }) {
  return <ul className="bet-receipt-selections" aria-label="Selections and stakes">{selections.map(selection => <li key={selection.number}><strong>{selection.number}</strong><Money paise={selection.stakePaise} /></li>)}</ul>;
}

export function WalletDelta({ paise }: { paise: number }) {
  return <span>{paise < 0 ? "Additional debit: " : paise > 0 ? "Refund: " : "Wallet change: "}<Money paise={Math.abs(paise)} /></span>;
}
