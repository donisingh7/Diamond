import { z } from "zod";

/**
 * Strict Zod for every Window 6A2 admin-operations route (withdrawals decisions, market config,
 * result declaration, payout rate, audit browser, dashboard, global bet reads). `.strict()`
 * everywhere: a client cannot smuggle `status`, `decidedByAdminId`, a resulting `balance`, a
 * `role`, an `actorAdminId` or any other authoritative field — the server forces them.
 *
 * The result string is validated as a two-character `"00".."99"` **string** (`/^\d{2}$/`) so a
 * leading zero is preserved and there is no numeric coercion anywhere.
 */

const HEX24 = /^[a-f0-9]{24}$/i;
const objectId = z.string().trim().regex(HEX24, "Expected a 24-character hex id.");
const uuid = z.uuid();

/** Accepts `YYYY-MM-DD` or a full ISO-8601 datetime; the service converts with `new Date(...)`. */
const dateFilter = z
  .string()
  .trim()
  .min(1)
  .max(40)
  .refine((value) => !Number.isNaN(Date.parse(value)), "Invalid date/time.");

/** A market business date, exactly `YYYY-MM-DD`. */
const businessDate = z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/, "Expected YYYY-MM-DD.");

/** The declared result: a two-character string, `"00"` through `"99"`. Leading zero preserved. */
export const resultStringSchema = z
  .string()
  .trim()
  .regex(/^\d{2}$/, 'Result must be a two-digit string "00"–"99".');

/** `HH:MM` 24-hour clock. */
const clockTime = z.string().trim().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Expected HH:MM (24-hour).");

// --- withdrawals -------------------------------------------------------------------------

/** `GET /api/admin/withdrawals` query — bounded global list, newest requested first. */
export const adminWithdrawalsListQuerySchema = z
  .object({
    status: z.enum(["PENDING", "APPROVED", "REJECTED", "CANCELLED"]).optional(),
    method: z.enum(["BANK", "UPI"]).optional(),
    search: z.string().trim().min(1).max(190).optional(),
    dateFrom: dateFilter.optional(),
    dateTo: dateFilter.optional(),
    limit: z.coerce.number().int().min(1).max(100).default(25),
    cursor: z.string().min(1).optional(),
  })
  .strict();
export type AdminWithdrawalsListQuery = z.infer<typeof adminWithdrawalsListQuerySchema>;

/**
 * `POST /api/admin/withdrawals/[id]/approve` — "Mark Paid & Approve". `confirmPaid` MUST be the
 * literal `true`: a body without it fails validation and no approval happens. `paymentReference`
 * is the operator's out-of-Diamond payout reference; `note` a bounded operator note.
 */
export const approveWithdrawalSchema = z
  .object({
    confirmPaid: z.literal(true),
    clientRequestId: uuid,
    paymentReference: z.string().trim().min(1).max(200).optional(),
    note: z.string().trim().min(1).max(500).optional(),
  })
  .strict();
export type ApproveWithdrawalRequest = z.infer<typeof approveWithdrawalSchema>;

/** `POST /api/admin/withdrawals/[id]/reject` — a bounded reason is REQUIRED. */
export const rejectWithdrawalSchema = z
  .object({
    reason: z.string().trim().min(1).max(500),
    clientRequestId: uuid,
    note: z.string().trim().min(1).max(500).optional(),
  })
  .strict();
export type RejectWithdrawalRequest = z.infer<typeof rejectWithdrawalSchema>;

// --- markets ---------------------------------------------------------------------------

/** `GET /api/admin/markets` query — optional `enabled` filter only. */
export const adminMarketsListQuerySchema = z
  .object({ enabled: z.enum(["true", "false"]).optional() })
  .strict();
export type AdminMarketsListQuery = z.infer<typeof adminMarketsListQuerySchema>;

/** `POST /api/admin/markets/[id]/status` — enable / emergency-disable. */
export const setMarketStatusSchema = z.object({ enabled: z.boolean() }).strict();
export type SetMarketStatusRequest = z.infer<typeof setMarketStatusSchema>;

/**
 * `POST /api/admin/markets/[id]/schedule` — future schedule configuration. Every field is
 * optional and merged onto the market's current schedule; at least one must be present. The
 * merged schedule is validated (ordering, ranges, cross-midnight, edit lock inside the round)
 * before it is written. Existing persisted `marketRounds` are NEVER rewritten — the change
 * applies to future newly-created rounds only.
 */
export const updateMarketScheduleSchema = z
  .object({
    openTime: clockTime.optional(),
    closeTime: clockTime.optional(),
    closeDayOffset: z.union([z.literal(0), z.literal(1)]).optional(),
    editLockMinutesBeforeClose: z.number().int().min(0).max(1440).optional(),
  })
  .strict()
  .refine(
    (value) => Object.values(value).some((field) => field !== undefined),
    "Provide at least one schedule field to update.",
  );
export type UpdateMarketScheduleRequest = z.infer<typeof updateMarketScheduleSchema>;

// --- result declaration (two-step) ----------------------------------------------------

/** `POST /api/admin/results/prepare` — validate + preview only, no mutation. */
export const prepareResultSchema = z
  .object({
    marketId: objectId,
    businessDate: businessDate.optional(),
    result: resultStringSchema,
  })
  .strict();
export type PrepareResultRequest = z.infer<typeof prepareResultSchema>;

/** `POST /api/admin/results/declare` — explicit confirmation step. `confirm` MUST be literal `true`. */
export const declareResultSchema = z
  .object({
    marketId: objectId,
    businessDate: businessDate.optional(),
    result: resultStringSchema,
    confirm: z.literal(true),
    clientRequestId: uuid,
  })
  .strict();
export type DeclareResultRequest = z.infer<typeof declareResultSchema>;

// --- settlement trigger (Window 7A2) ------------------------------------------------

/**
 * `POST /api/admin/results/settle` — run settlement of ONE already-declared round. `confirm`
 * MUST be the literal `true` so an empty/accidental body settles nothing. There is deliberately
 * NO `result` field: settlement always runs against the number Window 6A2 recorded, and
 * `.strict()` rejects any attempt to smuggle a different one through this route.
 */
export const settleRoundSchema = z
  .object({
    marketId: objectId,
    businessDate: businessDate.optional(),
    confirm: z.literal(true),
    clientRequestId: uuid,
  })
  .strict();
export type SettleRoundRequest = z.infer<typeof settleRoundSchema>;

// --- payout rate --------------------------------------------------------------------

/**
 * `POST /api/admin/settings/rate` — update the FUTURE payout multiplier. Existing `Bet`
 * `payoutMultiplierSnapshot` values are never touched. The model stores a positive integer
 * multiplier (currently `90`); the cap is a defence-in-depth sanity bound.
 */
export const updatePayoutRateSchema = z
  .object({ payoutMultiplier: z.number().int().min(1).max(1000) })
  .strict();
export type UpdatePayoutRateRequest = z.infer<typeof updatePayoutRateSchema>;

// --- audit browser ----------------------------------------------------------------

/** `GET /api/admin/audit` query — bounded, newest first, sanitized rows only. */
export const adminAuditListQuerySchema = z
  .object({
    action: z.string().trim().min(1).max(64).optional(),
    actorAdminId: objectId.optional(),
    subjectUserId: objectId.optional(),
    entityType: z.string().trim().min(1).max(64).optional(),
    dateFrom: dateFilter.optional(),
    dateTo: dateFilter.optional(),
    limit: z.coerce.number().int().min(1).max(100).default(25),
    cursor: z.string().min(1).optional(),
  })
  .strict();
export type AdminAuditListQuery = z.infer<typeof adminAuditListQuerySchema>;

// --- global bet reads -------------------------------------------------------------

/** `GET /api/admin/bets` query — bounded, newest first, READ ONLY. */
export const adminBetsListQuerySchema = z
  .object({
    playerId: objectId.optional(),
    market: z.string().trim().min(1).max(64).optional(),
    status: z.enum(["ACTIVE", "WON", "LOST"]).optional(),
    entryMethod: z.enum(["JODI", "CROSSING", "COPY_PASTE"]).optional(),
    businessDate: businessDate.optional(),
    dateFrom: dateFilter.optional(),
    dateTo: dateFilter.optional(),
    limit: z.coerce.number().int().min(1).max(50).default(20),
    cursor: z.string().min(1).optional(),
  })
  .strict();
export type AdminBetsListQuery = z.infer<typeof adminBetsListQuerySchema>;
