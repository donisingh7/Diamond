/** Centralized session/OTP security parameters. No secrets here — safe for client and server import. */
export const SESSION_COOKIE_NAME = "diamond_session";
export const SESSION_DURATION_MS = 7 * 24 * 60 * 60 * 1000;
export const OTP_EXPIRY_MS = 5 * 60 * 1000;
export const OTP_MAX_ATTEMPTS = 5;
export const OTP_RESEND_COOLDOWN_MS = 60 * 1000;
