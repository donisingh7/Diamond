import "server-only";
import { NextResponse, type NextRequest } from "next/server";
import { apiRoute } from "@/lib/api/handler";
import { requirePlayer } from "@/lib/auth/session";
import { walletTransactionsQuerySchema } from "@/modules/wallet/validators/wallet-input";
import { listWalletTransactions } from "@/modules/wallet/services/wallet-transactions.service";

export const dynamic = "force-dynamic";

/**
 * GET /api/wallet/transactions — ACTIVE PLAYER only. Own ledger, newest first, bounded
 * (`?limit=` 1–100 default 20, `?cursor=` opaque). An ADMIN session is `403`. Internal
 * admin/security metadata (idempotency key, admin attribution) is never serialized.
 */
export const GET = apiRoute(async (request: NextRequest) => {
  const user = await requirePlayer();
  const query = walletTransactionsQuerySchema.parse(Object.fromEntries(request.nextUrl.searchParams));
  const page = await listWalletTransactions(user._id, { limit: query.limit, cursor: query.cursor });
  return NextResponse.json({ data: { ...page, serverNow: new Date().toISOString() } });
});
