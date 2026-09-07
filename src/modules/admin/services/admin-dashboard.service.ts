import "server-only";
import { DateTime } from "luxon";
import { User } from "@/modules/users/models/user.model";
import { Wallet } from "@/modules/wallet/models/wallet.model";
import { Bet } from "@/modules/betting/models/bet.model";
import { Withdrawal } from "@/modules/withdrawals/models/withdrawal.model";
import { getMarketsWithCurrentRounds } from "@/modules/markets/services/market.service";
import { listAuditLogs, type AdminAuditLogDTO } from "./admin-audit.service";

/**
 * Admin operational summary backend (Window 6A2) — server-calculated aggregates for a future
 * Window 6B dashboard UI. Every number is a real query result (no fabricated values); the
 * queries are aggregates / counts, not per-row loops. This is NOT an analytics warehouse.
 *
 * "Today" for the bet aggregates is the current IST calendar day (`createdAt >= IST 00:00`).
 */

const PLATFORM_TIMEZONE = "Asia/Kolkata";

export type AdminMarketStatusSummary = {
  slug: string;
  name: string;
  enabled: boolean;
  state: string;
  businessDate: string;
  closesAt: string | null;
  result: string | null;
};

export type AdminDashboard = {
  players: { active: number; disabled: number; total: number };
  wallet: { totalAvailablePaise: number; totalReservedPaise: number };
  withdrawals: { pendingCount: number; pendingAmountPaise: number };
  betsToday: { count: number; totalStakePaise: number; sinceIso: string };
  markets: AdminMarketStatusSummary[];
  results: { pending: number; declared: number };
  recentActivity: AdminAuditLogDTO[];
  serverNow: string;
};

export async function getAdminDashboard(now: Date = new Date()): Promise<AdminDashboard> {
  const istDayStart = DateTime.fromJSDate(now, { zone: PLATFORM_TIMEZONE }).startOf("day").toJSDate();

  const [
    activePlayers,
    disabledPlayers,
    walletTotals,
    pendingWithdrawalCount,
    pendingWithdrawalTotals,
    betsTodayTotals,
    marketsWithRounds,
    recent,
  ] = await Promise.all([
    User.countDocuments({ role: "PLAYER", status: "ACTIVE" }),
    User.countDocuments({ role: "PLAYER", status: "DISABLED" }),
    Wallet.aggregate<{ available: number; reserved: number }>([
      {
        $group: {
          _id: null,
          available: { $sum: "$availableBalancePaise" },
          reserved: { $sum: "$reservedBalancePaise" },
        },
      },
    ]),
    Withdrawal.countDocuments({ status: "PENDING" }),
    Withdrawal.aggregate<{ amount: number }>([
      { $match: { status: "PENDING" } },
      { $group: { _id: null, amount: { $sum: "$amountPaise" } } },
    ]),
    Bet.aggregate<{ count: number; stake: number }>([
      { $match: { createdAt: { $gte: istDayStart } } },
      { $group: { _id: null, count: { $sum: 1 }, stake: { $sum: "$totalStakePaise" } } },
    ]),
    getMarketsWithCurrentRounds(now),
    listAuditLogs({ limit: 10 }),
  ]);

  const markets: AdminMarketStatusSummary[] = marketsWithRounds.map(({ market, resolved }) => ({
    slug: market.slug,
    name: market.name,
    enabled: market.enabled,
    state: resolved.state,
    businessDate: resolved.businessDate,
    closesAt: resolved.round ? resolved.round.closesAt.toISOString() : null,
    result: resolved.round?.result ?? null,
  }));

  return {
    players: {
      active: activePlayers,
      disabled: disabledPlayers,
      total: activePlayers + disabledPlayers,
    },
    wallet: {
      totalAvailablePaise: walletTotals[0]?.available ?? 0,
      totalReservedPaise: walletTotals[0]?.reserved ?? 0,
    },
    withdrawals: {
      pendingCount: pendingWithdrawalCount,
      pendingAmountPaise: pendingWithdrawalTotals[0]?.amount ?? 0,
    },
    betsToday: {
      count: betsTodayTotals[0]?.count ?? 0,
      totalStakePaise: betsTodayTotals[0]?.stake ?? 0,
      sinceIso: istDayStart.toISOString(),
    },
    markets,
    results: {
      pending: markets.filter((m) => m.state === "RESULT_PENDING").length,
      declared: markets.filter((m) => m.result != null).length,
    },
    recentActivity: recent.logs,
    serverNow: now.toISOString(),
  };
}
