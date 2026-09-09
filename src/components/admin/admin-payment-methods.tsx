"use client";

import { useEffect, useRef, useState } from "react";
import { useAdminApi, useAdminMutation } from "@/lib/ui/use-admin-api";
import { createMethodInput, updateMethodInput, type AdminPaymentMethod } from "@/lib/ui/deposit-contract";
import { GlassCard, GlassPanel } from "@/components/ui/surface";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Alert } from "@/components/ui/feedback";
import { PaymentDetails, PaymentUpload } from "@/components/shared/payment-presentation";
import { AdminConfirm, FormAction, Intro, ReadState, Select, Status, formText } from "./admin-ui";

export function AdminPaymentMethods() {
  const api = useAdminApi<{ paymentMethods: AdminPaymentMethod[] }>("/api/admin/payment-methods");
  const tx = useAdminMutation<{ paymentMethod: AdminPaymentMethod }>();
  const [editing, setEditing] = useState<AdminPaymentMethod | "new">();
  const [notice, setNotice] = useState<string>();
  return <div className="stack-lg admin-operations"><Intro title="Payment Methods" description="Manage the UPI and bank destinations players use to pay externally."><Button disabled={!!editing || !!tx.job} onClick={() => { setEditing("new"); setNotice(undefined); }}>Create payment method</Button></Intro>
    {notice && <Alert tone="success" title="Payment method saved">{notice}</Alert>}
    {tx.result && <Alert tone="success" title="Availability updated">{tx.result.paymentMethod.displayName} is {tx.result.paymentMethod.isActive ? "active" : "inactive"}.</Alert>}
    {editing && <PaymentMethodEditor key={editing === "new" ? "new" : editing.id} method={editing === "new" ? undefined : editing} onClose={() => setEditing(undefined)} onSuccess={method => { setEditing(undefined); setNotice(`${method.displayName} · ${method.isActive ? "Active" : "Inactive"}`); void api.refresh(); }} />}
    <div className="between"><p className="type-body-small text-secondary">Lower display order appears first. Historical deposit details stay unchanged.</p><Button variant="secondary" loading={api.loading} onClick={() => void api.refresh()}>Refresh methods</Button></div>
    <ReadState api={api} empty={!api.data?.paymentMethods.length}><ul className="admin-records">{api.data?.paymentMethods.map(method => <li key={method.id}><GlassCard className="stack"><div className="between"><Status value={method.isActive ? "ACTIVE" : "INACTIVE"} /><span className="type-caption text-secondary">Display order: {method.sortOrder}</span></div><PaymentDetails method={method} />
      <div className="wallet-actions"><Button variant="secondary" disabled={!!editing || !!tx.job} onClick={() => { setEditing(method); setNotice(undefined); }}>Edit method</Button><Button variant={method.isActive ? "ghost" : "secondary"} disabled={!!editing || !!tx.job} onClick={() => tx.prepare({ url: `/api/admin/payment-methods/${encodeURIComponent(method.id)}`, method: "PATCH", body: { isActive: !method.isActive }, title: method.isActive ? "Deactivate payment method?" : "Activate payment method?", description: `${method.displayName}\n${method.isActive ? "Players will no longer see this destination for new deposits. Existing requests are preserved." : "This destination will be shown to players for new payments. Verify the payment details before activating."}`, confirmLabel: method.isActive ? "Deactivate method" : "Activate method" })}>{method.isActive ? "Deactivate" : "Activate"}</Button></div>
    </GlassCard></li>)}</ul></ReadState><AdminConfirm tx={tx} onSuccess={() => void api.refresh()} />
  </div>;
}
function PaymentMethodEditor({ method, onClose, onSuccess }: { method?: AdminPaymentMethod; onClose: () => void; onSuccess: (method: AdminPaymentMethod) => void }) {
  const tx = useAdminMutation<{ paymentMethod: AdminPaymentMethod }>();
  const [type, setType] = useState<"UPI" | "BANK">(method?.type ?? "UPI");
  const [qrId, setQrId] = useState<string | undefined>(method?.qrImageId ?? undefined);
  const [uploading, setUploading] = useState(false);
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => { heading.current?.focus(); }, []);
  return <GlassPanel className="stack admin-narrow"><div className="between"><h2 ref={heading} tabIndex={-1} className="type-section-title">{method ? "Edit payment method" : "Create payment method"}</h2><Button variant="ghost" disabled={uploading || !!tx.job} onClick={onClose}>Close editor</Button></div>
    <Select label="Payment type" value={type} disabled={!!method || !!tx.job || uploading} onChange={event => { setType(event.target.value as "UPI" | "BANK"); setQrId(undefined); }}><option value="UPI">UPI</option><option value="BANK">Bank transfer</option></Select>
    <FormAction disabled={uploading || !!tx.job} prepare={tx.prepare} build={data => {
      const common = { displayName: formText(data, "displayName"), instructions: formText(data, "instructions"), sortOrder: Number(formText(data, "sortOrder")), isActive: data.get("isActive") === "on" };
      const coordinates = type === "UPI" ? { upiId: formText(data, "upiId"), ...(qrId ? { qrImageId: qrId } : {}) } : {
        accountHolderName: formText(data, "accountHolderName"), bankName: formText(data, "bankName"), ifsc: formText(data, "ifsc"),
        ...(!method || formText(data, "accountNumber") ? { accountNumber: formText(data, "accountNumber") } : {}),
      };
      const body = method ? updateMethodInput.parse({ ...common, ...coordinates }) : createMethodInput.parse({ type, ...common, ...coordinates });
      return { url: `/api/admin/payment-methods${method ? `/${encodeURIComponent(method.id)}` : ""}`, method: method ? "PATCH" : "POST", body,
        title: method ? "Save payment method changes?" : "Create payment method?", description: `${common.displayName} · ${type}\n${common.isActive ? "Active — visible to players" : "Inactive — hidden from players"}\nDisplay order: ${common.sortOrder}\nVerify all payment details. Players pay externally to this destination.`, confirmLabel: method ? "Save changes" : "Create method" };
    }}>
      <Input name="displayName" label="Display name" required minLength={2} maxLength={120} defaultValue={method?.displayName} />
      {type === "UPI" ? <><Input name="upiId" label="UPI ID" autoCapitalize="none" spellCheck={false} required maxLength={256} defaultValue={method?.upiId ?? ""} /><PaymentUpload kind="qr" imageId={qrId} onChange={setQrId} onBusy={setUploading} disabled={!!tx.job} /></> : <div className="admin-form-grid">
        <Input name="accountHolderName" label="Account holder" required minLength={2} maxLength={140} defaultValue={method?.accountHolderName ?? ""} /><Input name="bankName" label="Bank name" required minLength={2} maxLength={140} defaultValue={method?.bankName ?? ""} />
        <Input name="accountNumber" label={method ? "Replace account number (optional)" : "Account number"} required={!method} inputMode="numeric" minLength={6} maxLength={20} autoComplete="off" helperText={method ? `Current: ${method.accountNumberMasked ?? "Unavailable"}. Leave blank to keep it.` : undefined} /><Input name="ifsc" label="IFSC" required maxLength={11} autoCapitalize="characters" spellCheck={false} defaultValue={method?.ifsc ?? ""} />
      </div>}
      <label className="field payment-textarea"><span className="type-label">Payment instructions (optional)</span><textarea name="instructions" maxLength={2000} rows={4} defaultValue={method?.instructions ?? ""} /></label>
      <Input name="sortOrder" label="Display order" type="number" step={1} min={-100000} max={100000} required defaultValue={method?.sortOrder ?? 0} helperText="Lower numbers appear first." />
      <label className="admin-check"><input type="checkbox" name="isActive" defaultChecked={method?.isActive ?? false} />Active — show this destination to players</label>
    </FormAction><AdminConfirm tx={tx} onSuccess={result => onSuccess(result.paymentMethod)} />
  </GlassPanel>;
}
