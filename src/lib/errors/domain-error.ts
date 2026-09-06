export const errorCodes = [
  "INVALID_CREDENTIALS", "USER_DISABLED", "MARKET_CLOSED", "MARKET_DISABLED",
  "EDIT_WINDOW_CLOSED", "INSUFFICIENT_BALANCE", "INVALID_SELECTION",
  "STAKE_BELOW_MINIMUM", "BET_ALREADY_SETTLED", "WITHDRAWAL_NOT_PENDING",
  "DUPLICATE_REQUEST", "FORBIDDEN", "UNAUTHENTICATED", "INVALID_INPUT",
  "MONEY_OUT_OF_RANGE", "INTERNAL_ERROR",
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
