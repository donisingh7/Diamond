"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import type { AdminPlayersPage, AdminPlayerDetail, AdminPlayerSummary } from "@/modules/admin/services/admin-player.service";
import type { AdminWalletAdjustmentResult, AdminWalletTransactionsPage } from "@/modules/admin/services/admin-wallet.service";
import { createPlayerSchema, adminWalletAdjustmentSchema } from "@/modules/admin/validators/admin-player-input";
import { useAdminApi, useAdminMutation, useAdminPage } from "@/lib/ui/use-admin-api";
import { rupeesToPaise, formatINR } from "@/lib/money";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Alert } from "@/components/ui/feedback";
import { Money } from "@/components/ui/money";
import { GlassCard, GlassPanel } from "@/components/ui/surface";
import { BetTime } from "@/components/player/bet-presentation";
import { AdminConfirm, Filters, FormAction, Intro, Pages, ReadState, Select, Status, formText, optionalText, label } from "./admin-ui";

export function AdminPlayers() {
  const api = useAdminPage<AdminPlayersPage>("/api/admin/players");
  const create = useAdminMutation<{ player: AdminPlayerSummary }>();
  const router = useRouter();
  return <div className="stack-lg admin-operations"><Intro title="Players" description="Manage access and open a player’s wallet or activity." />
    <details className="admin-disclosure"><summary>Create player</summary><GlassPanel><FormAction label="Review new player" prepare={create.prepare} disabled={!!create.job} build={data => {
      const body = createPlayerSchema.parse({ loginId: formText(data, "loginId"), name: formText(data, "name"), password: String(data.get("password") ?? ""), ...optionalText(data, "phone"), ...optionalText(data, "email") });
      return { url: "/api/admin/players", body, title: "Create player", description: `${body.name} · ${body.loginId}\nCreates an active player with a zero-balance wallet.`, confirmLabel: "Create player" };
    }}><div className="admin-form-grid"><Input name="name" label="Name" required maxLength={190} /><Input name="loginId" label="Login ID" required maxLength={190} autoComplete="off" /><Input name="password" label="Initial password" type="password" autoComplete="new-password" required maxLength={1024} /><Input name="phone" label="Phone (optional)" type="tel" minLength={4} maxLength={20} /><Input name="email" label="Email (optional)" type="email" /></div></FormAction></GlassPanel></details>
    <Filters onApply={api.filter} fields={[{ name: "search", label: "Search login ID, email or phone" }, { name: "status", label: "Status", options: ["ACTIVE", "DISABLED"] }]} />
    <ReadState api={api} empty={!api.data?.players.length}><ul className="admin-records">{api.data?.players.map(player => <li key={player.id}><GlassCard className="stack"><div className="between"><div><Link className="text-link type-card-title" href={`/admin/players/${player.id}`}>{player.name}</Link><p className="type-caption text-secondary">{player.loginId}</p></div><Status value={player.status} /></div><div className="admin-form-grid"><p>Available <Money paise={player.availableBalancePaise} /></p><p>Reserved <Money paise={player.reservedBalancePaise} /></p></div><p className="type-caption text-secondary">{player.betCount} bets · {player.withdrawalCount} withdrawals</p></GlassCard></li>)}</ul></ReadState><Pages api={api} next={api.data?.nextCursor} />
    <AdminConfirm tx={create} onSuccess={result => router.push(`/admin/players/${result.player.id}`)} />
  </div>;
}

export function AdminPlayer({ id }: { id: string }) {
  const api = useAdminApi<{ player: AdminPlayerDetail }>(`/api/admin/players/${encodeURIComponent(id)}`);
  const ledger = useAdminPage<AdminWalletTransactionsPage>(`/api/admin/players/${encodeURIComponent(id)}/wallet/transactions`);
  const status = useAdminMutation<{ player: AdminPlayerSummary }>();
  const purge = useAdminMutation<{ purged: boolean }>();
  const wallet = useAdminMutation<AdminWalletAdjustmentResult>();
  const router = useRouter();
  const player = api.data?.player;
  const locked = !!status.job || !!purge.job || !!wallet.job;
  return <div className="stack-lg admin-operations"><Link className="text-link" href="/admin/players">← Players</Link><Intro title={player?.name ?? "Player detail"} description="Player access, balances and wallet activity." />
    {status.result && <Alert tone="success" title="Player access updated">{label(status.result.player.status)}</Alert>}
    {wallet.result && <Alert tone="success" title={wallet.result.idempotentReplay ? "Existing wallet adjustment recovered" : "Wallet adjustment confirmed"}><Money paise={wallet.result.transaction.amountPaise} /> · {label(wallet.result.transaction.type)}</Alert>}
    <ReadState api={api}>{player && <><div className="admin-form-grid"><GlassPanel className="stack"><div className="between"><h2 className="type-section-title">{player.loginId}</h2><Status value={player.status} /></div><dl className="bet-facts"><div><dt>Phone</dt><dd>{player.phone ?? "Not provided"}</dd></div><div><dt>Email</dt><dd>{player.email ?? "Not provided"}</dd></div><div><dt>Created</dt><dd><BetTime value={player.createdAt} /></dd></div></dl><div className="wallet-actions"><Button variant="secondary" disabled={locked} onClick={() => status.prepare({ url: `/api/admin/players/${id}/status`, body: { status: player.status === "ACTIVE" ? "DISABLED" : "ACTIVE" }, title: player.status === "ACTIVE" ? "Disable player" : "Enable player", description: `${player.name} · ${player.loginId}\n${player.status === "ACTIVE" ? "Disabling revokes all current player sessions. History is retained." : "The player will be able to log in again."}` })}>{player.status === "ACTIVE" ? "Disable player" : "Enable player"}</Button><Link className="button button--secondary" href={`/admin/players/${id}/bets`}>View bets</Link><Link className="button button--secondary" href={`/admin/players/${id}/withdrawals`}>Withdrawals</Link></div></GlassPanel>
      <GlassCard className="wallet-summary"><p className="eyebrow">Player wallet · INR</p><div><p className="type-label">Available</p><Money size="large" paise={player.wallet.availableBalancePaise} /></div><div><p className="type-label">Reserved</p><Money size="medium" paise={player.wallet.reservedBalancePaise} /></div></GlassCard></div>
      <GlassPanel className="stack"><h2 className="type-section-title">Manual wallet adjustment</h2><p className="text-secondary type-body-small">Credit only after verifying payment received outside Diamond. Debit creates a new correction entry. Reserved funds and existing transactions remain unchanged.</p>
        <FormAction key={wallet.result?.transaction.id ?? "new"} disabled={locked} prepare={wallet.prepare} build={data => {
          const operation = formText(data, "operation");
          const body = adminWalletAdjustmentSchema.parse({ amountPaise: rupeesToPaise(formText(data, "amount")), reason: formText(data, "reason"), ...optionalText(data, "paymentReference"), clientRequestId: crypto.randomUUID() });
          return { url: `/api/admin/players/${id}/wallet/${operation}`, body, replaySafe: true, title: `${operation === "credit" ? "Credit" : "Debit"} player wallet`, description: `${player.name} · ${player.loginId}\nAmount: ${formatINR(body.amountPaise)}\nReason: ${body.reason}\nReference: ${body.paymentReference ?? "Not provided"}\n${operation === "credit" ? "Confirm the external payment has been verified." : "This removes money from the player’s available balance."}`, confirmLabel: `Confirm ${operation}`, destructive: operation === "debit" };
        }}><div className="admin-form-grid"><Select name="operation" label="Operation"><option value="credit">CREDIT</option><option value="debit">DEBIT</option></Select><Input name="amount" label="Amount (₹)" inputMode="decimal" required maxLength={32} /><Input name="reason" label="Reason" required maxLength={500} /><Input name="paymentReference" label="Payment reference (optional)" maxLength={200} /></div></FormAction>
      </GlassPanel>
      <details className="admin-disclosure admin-disclosure--danger"><summary>Permanent deletion</summary><GlassPanel className="stack"><p className="text-secondary">Hard deletion permanently removes this player and all identifying application data, including wallet, ledger, bets, revisions, withdrawals and sessions. This cannot be undone.</p><Button variant="danger" disabled={locked} onClick={() => purge.prepare({ url: `/api/admin/players/${id}`, method: "DELETE", title: "Permanently delete player", description: `Delete ${player.name} (${player.loginId}) and all related application data permanently? This cannot be undone.`, confirmationText: player.loginId, destructive: true, confirmLabel: "Permanently delete player" })}>Delete player permanently</Button></GlassPanel></details>
    </>}</ReadState>
    <GlassPanel className="stack"><h2 className="type-section-title">Wallet transactions</h2><ReadState api={ledger} empty={!ledger.data?.transactions.length}><ul className="wallet-records">{ledger.data?.transactions.map(item => <li key={item.id}><div className="between"><h3 className="type-label">{label(item.type)}</h3><Money paise={item.amountPaise} /></div><p className="type-caption text-secondary"><BetTime value={item.createdAt} /></p><div className="wallet-deltas"><span>Available <Money paise={item.availableDeltaPaise} showPositive /></span><span>Reserved <Money paise={item.reservedDeltaPaise} showPositive /></span></div>{item.reason && <p className="type-body-small">Reason: {item.reason}</p>}{item.paymentReference && <p className="type-caption">Reference: {item.paymentReference}</p>}</li>)}</ul></ReadState><Pages api={ledger} next={ledger.data?.nextCursor} /></GlassPanel>
    <AdminConfirm tx={status} onSuccess={() => void api.refresh()} /><AdminConfirm tx={purge} onSuccess={() => router.replace("/admin/players")} /><AdminConfirm tx={wallet} onSuccess={() => { void api.refresh(); void ledger.refresh(); }} />
  </div>;
}
