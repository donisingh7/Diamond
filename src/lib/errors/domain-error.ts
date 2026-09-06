export const errorCodes = [
  "INVALID_CREDENTIALS", "USER_DISABLED", "MARKET_CLOSED", "MARKET_DISABLED",
  "MARKET_NOT_FOUND", "MARKET_NOT_OPEN", "ROUND_NOT_FOUND", "INVALID_RESULT_RANGE",
  "EDIT_WINDOW_CLOSED", "WALLET_NOT_FOUND", "INSUFFICIENT_BALANCE", "INVALID_AMOUNT",
  "INVALID_SELECTION",
  "STAKE_BELOW_MINIMUM", "BET_ALREADY_SETTLED", "BET_NOT_FOUND", "STALE_VERSION",
  "WITHDRAWAL_NOT_FOUND", "WITHDRAWAL_NOT_PENDING",
  "DUPLICATE_REQUEST", "FORBIDDEN", "UNAUTHENTICATED", "INVALID_INPUT",
  "MONEY_OUT_OF_RANGE", "INTERNAL_ERROR", "INVALID_OTP",
] as const;

export type ErrorCode = (typeof errorCodes)[number];

export class DomainError extends Error {
  constructor(public readonly code: ErrorCode, message: string) {
    super(message);
    this.name = "DomainError";
  }
}

/** Only deliberately public domain messages may cross an HTTP boundary. */
export function toPublicError(error: unknown) {
  if (error instanceof DomainError) {
    return { code: error.code, message: error.message };
  }
  return { code: "INTERNAL_ERROR" as const, message: "Something went wrong. Please try again." };
}

/** Matches API_CONTRACTS.md's status families: 400 malformed, 401 unauthenticated, 403 forbidden/disabled, 409 conflict, 422 valid-shaped-but-invalid, 500 unexpected. */
const statusByCode: Record<ErrorCode, number> = {
  INVALID_CREDENTIALS: 401, USER_DISABLED: 403, MARKET_CLOSED: 422, MARKET_DISABLED: 422,
  MARKET_NOT_FOUND: 404, MARKET_NOT_OPEN: 422, ROUND_NOT_FOUND: 404, INVALID_RESULT_RANGE: 400,
  EDIT_WINDOW_CLOSED: 422, WALLET_NOT_FOUND: 404, INSUFFICIENT_BALANCE: 422, INVALID_AMOUNT: 422,
  INVALID_SELECTION: 422,
  STAKE_BELOW_MINIMUM: 422, BET_ALREADY_SETTLED: 409, BET_NOT_FOUND: 404, STALE_VERSION: 409,
  WITHDRAWAL_NOT_FOUND: 404, WITHDRAWAL_NOT_PENDING: 409,
  DUPLICATE_REQUEST: 409, FORBIDDEN: 403, UNAUTHENTICATED: 401, INVALID_INPUT: 400,
  MONEY_OUT_OF_RANGE: 422, INTERNAL_ERROR: 500, INVALID_OTP: 422,
};
export function httpStatusForError(error: unknown): number {
  return error instanceof DomainError ? statusByCode[error.code] : 500;
}
