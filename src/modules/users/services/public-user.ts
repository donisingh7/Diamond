import "server-only";
import type { ActiveUser } from "@/modules/auth/services/session.service";

/** The only allowlisted user shape ever sent to a browser; never spread a hydrated document. */
export function toPublicUser(user: ActiveUser) {
  return {
    id: user._id.toString(),
    role: user.role,
    loginId: user.loginId,
    name: user.name,
    phone: user.phone ?? null,
    email: user.email ?? null,
    status: user.status,
  };
}

export type PublicUser = ReturnType<typeof toPublicUser>;
