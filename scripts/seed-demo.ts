import { Types } from "mongoose";
import { getDemoSeedEnv } from "../src/lib/config/env";
import { requireTransactions, withTransaction } from "../src/lib/db/connection";
import { ensureIndexes } from "../src/lib/db/models";
import { seedFoundation } from "../src/modules/settings/services/seed-foundation";
import { hashPassword } from "../src/lib/auth/password";
import { User } from "../src/modules/users/models/user.model";
import { normalizeLoginId } from "../src/modules/users/validators/identity";
import {
  applyWalletMovement,
  createPlayerWallet,
  getTransactionByIdempotencyKey,
  isDuplicateKeyError,
} from "../src/modules/wallet/services/wallet.service";
import { writeAuditLog } from "../src/modules/audit/services/audit-log.service";
import { runScript } from "./runtime";

/**
 * `npm run db:seed-demo` — guarded demo deployment seed. Does NOT run on app startup; requires
 * `DEMO_SEED_ENABLED=true` plus the demo passwords in the environment (see `.env.example`). It
 * is deterministic, idempotent and non-destructive:
 *   - four accounts (1 PLAYER `test1`, 3 ADMIN `doni` / `pankaj` / `gopal`), created once,
 *     passwords stored hashed — an existing account is preserved untouched,
 *   - a pre-flight scan aborts with NO writes if any of those login ids already exists with a
 *     different role (never silently repurpose a real account),
 *   - the demo player's ₹10,000 opening balance is a genuine keyed `ADMIN_CREDIT` movement
 *     (never a direct balance write); the deterministic idempotency key means a rerun never
 *     adds a second ₹10,000.
 *
 * No password or hash is ever printed.
 */

const DEMO_OPENING_BALANCE_PAISE = 1_000_000; // ₹10,000
const DEMO_OPENING_BALANCE_KEY = "ADMIN_CREDIT:DEMO_OPENING_BALANCE:test1:v1";

type DemoSpec = {
  loginId: string;
  name: string;
  role: "PLAYER" | "ADMIN";
  password: string;
  phone?: string;
};

void runScript(async () => {
  const env = getDemoSeedEnv();
  await requireTransactions();
  await ensureIndexes();
  await seedFoundation();

  const specs: DemoSpec[] = ([
    { loginId: "test1", name: "Test Player", role: "PLAYER", password: env.DEMO_PLAYER_PASSWORD, phone: env.DEMO_PLAYER_PHONE },
    { loginId: "doni", name: "Doni", role: "ADMIN", password: env.DEMO_ADMIN_DONI_PASSWORD },
    { loginId: "pankaj", name: "Pankaj", role: "ADMIN", password: env.DEMO_ADMIN_PANKAJ_PASSWORD },
    { loginId: "gopal", name: "Gopal", role: "ADMIN", password: env.DEMO_ADMIN_GOPAL_PASSWORD },
  ] satisfies DemoSpec[]).map((spec) => ({ ...spec, loginId: normalizeLoginId(spec.loginId) }));

  // Pre-flight: fail before any write if a login id belongs to a different role already.
  for (const spec of specs) {
    const existing = await User.findOne({ loginId: spec.loginId }).select("role").lean<{ role: string } | null>();
    if (existing && existing.role !== spec.role) {
      throw new Error(
        `Login "${spec.loginId}" already exists with role ${existing.role}; refusing to repurpose it. No changes made.`,
      );
    }
  }

  let created = 0;
  let preserved = 0;
  const idByLogin = new Map<string, Types.ObjectId>();

  for (const spec of specs) {
    const existing = await User.findOne({ loginId: spec.loginId }).select("_id").lean<{ _id: Types.ObjectId } | null>();
    if (existing) {
      idByLogin.set(spec.loginId, existing._id);
      preserved += 1;
      if (spec.role === "PLAYER") await createPlayerWallet(existing._id);
      continue;
    }

    const passwordHash = await hashPassword(spec.password);
    const id = new Types.ObjectId();
    try {
      await withTransaction(async (session) => {
        await User.create(
          [
            {
              _id: id,
              role: spec.role,
              loginId: spec.loginId,
              name: spec.name,
              ...(spec.phone ? { phone: spec.phone } : {}),
              passwordHash,
              status: "ACTIVE",
              passwordChangedAt: new Date(),
            },
          ],
          { session },
        );
        if (spec.role === "PLAYER") await createPlayerWallet(id, session);
      });
      idByLogin.set(spec.loginId, id);
      created += 1;
    } catch (error) {
      if (!isDuplicateKeyError(error)) throw error;
      const raced = await User.findOne({ loginId: spec.loginId }).select("_id role").lean<{ _id: Types.ObjectId; role: string } | null>();
      if (!raced || raced.role !== spec.role) throw error;
      idByLogin.set(spec.loginId, raced._id);
      preserved += 1;
      if (spec.role === "PLAYER") await createPlayerWallet(raced._id);
    }
  }

  const playerId = idByLogin.get("test1");
  const adminId = idByLogin.get("doni");
  if (!playerId || !adminId) throw new Error("Demo accounts missing after seeding; aborting opening credit.");

  let openingCredit: "applied" | "already-present";
  if (await getTransactionByIdempotencyKey(DEMO_OPENING_BALANCE_KEY)) {
    openingCredit = "already-present";
  } else {
    await createPlayerWallet(playerId);
    await withTransaction(async (session) => {
      const movement = await applyWalletMovement(
        {
          userId: playerId,
          type: "ADMIN_CREDIT",
          amountPaise: DEMO_OPENING_BALANCE_PAISE,
          idempotencyKey: DEMO_OPENING_BALANCE_KEY,
          referenceType: "DEMO_OPENING_BALANCE",
          actorAdminId: adminId,
          adminReason: "Demo environment opening balance",
        },
        session,
      );
      await writeAuditLog(
        {
          actorAdminId: adminId,
          action: "ADMIN_WALLET_CREDIT",
          entityType: "Wallet",
          subjectUserId: playerId,
          after: {
            amountPaise: DEMO_OPENING_BALANCE_PAISE,
            reason: "Demo environment opening balance",
            paymentReference: null,
            availableBalancePaise: movement.availableBalancePaise,
            reservedBalancePaise: movement.reservedBalancePaise,
          },
        },
        session,
      );
    });
    openingCredit = "applied";
  }

  console.log(
    `Demo seed complete. Accounts ensured: ${specs.length} (created ${created}, preserved ${preserved}). ` +
      `Demo player opening credit: ${openingCredit}.`,
  );
});
