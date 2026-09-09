"use client";

import Image from "next/image";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Alert, Badge } from "@/components/ui/feedback";
import { Money } from "@/components/ui/money";
import { BetTime } from "@/components/player/bet-presentation";
import type { Deposit, PaymentSnapshot, PlayerPaymentMethod } from "@/lib/ui/deposit-contract";
import { maskedUtr } from "@/lib/ui/deposit-contract";
import { depositRequest } from "@/lib/ui/use-deposit-action";

export function PaymentImage({ src, alt, qr = false }: { src: string; alt: string; qr?: boolean }) {
  const [failed, setFailed] = useState(false);
  return failed ? <Alert tone="warning" title="Image unavailable"><Button size="sm" variant="secondary" onClick={() => setFailed(false)}>Retry image</Button></Alert>
    : <a className={`payment-image${qr ? " payment-image--qr" : ""}`} href={src} target="_blank" rel="noopener noreferrer" aria-label={`${alt} — open full image in a new tab`}><Image unoptimized src={src} alt={alt} width={640} height={640} onError={() => setFailed(true)} /></a>;
}
export function PaymentUpload({ kind, imageId, onChange, disabled, onBusy }: {
  kind: "proof" | "qr"; imageId?: string; onChange: (id: string | undefined) => void; disabled?: boolean; onBusy: (busy: boolean) => void;
}) {
  const [file, setFile] = useState<File>();
  const [preview, setPreview] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const lock = useRef(false);
  useEffect(() => {
    if (preview) return () => URL.revokeObjectURL(preview);
  }, [preview]);
  async function upload(selected: File) {
    if (lock.current) return;
    if (!["image/png", "image/jpeg", "image/webp"].includes(selected.type) || selected.size < 1 || selected.size > 5 * 1024 * 1024) {
      setError("Choose a PNG, JPEG or WebP image, up to 5 MB."); return;
    }
    lock.current = true; setBusy(true); onBusy(true); setError(undefined); onChange(undefined);
    try {
      const body = new FormData(); body.set("file", selected);
      const result = await depositRequest<{ proofImageId?: string; qrImageId?: string }>(kind === "proof" ? "/api/deposits/proof" : "/api/admin/payment-methods/qr", body);
      const id = kind === "proof" ? result.proofImageId : result.qrImageId;
      if (!id) throw new Error("Image upload was not confirmed. Try uploading again.");
      onChange(id);
    } catch { setError("Image upload could not be confirmed. Check your connection and try again."); }
    finally { lock.current = false; setBusy(false); onBusy(false); }
  }
  return <div className="stack payment-upload" aria-busy={busy}>
    <Input type="file" label={kind === "proof" ? "Payment screenshot (required)" : "UPI QR image"} accept="image/png,image/jpeg,image/webp" disabled={disabled || busy} helperText="PNG, JPEG or WebP · Up to 5 MB" error={error} onChange={event => {
      const selected = event.target.files?.[0];
      if (selected) {
        onChange(undefined);
        if (!["image/png", "image/jpeg", "image/webp"].includes(selected.type) || selected.size < 1 || selected.size > 5 * 1024 * 1024) {
          setFile(undefined); setPreview(undefined); setError("Choose a PNG, JPEG or WebP image, up to 5 MB."); return;
        }
        setFile(selected); setPreview(URL.createObjectURL(selected)); void upload(selected);
      }
    }} />
    {(preview || imageId) && <PaymentImage key={preview ?? imageId} src={preview ?? `/api/deposits/proof/${encodeURIComponent(imageId!)}`} alt={kind === "proof" ? "Payment screenshot preview" : "UPI payment QR"} qr={kind === "qr"} />}
    <p className="type-caption text-secondary" role="status">{busy ? "Uploading image…" : imageId ? "Image uploaded." : ""}</p>
    {error && file && <Button variant="secondary" size="sm" disabled={disabled || busy} onClick={() => void upload(file)}>Retry upload</Button>}
  </div>;
}
function CopyDetail({ title, value, copyable }: { title: string; value?: string | null; copyable: boolean }) {
  const [notice, setNotice] = useState("");
  if (!value) return null;
  return <div><dt>{title}</dt><dd><span>{value}</span>{copyable && <Button variant="ghost" size="sm" aria-label={`Copy ${title}`} onClick={async () => { try { await navigator.clipboard.writeText(value); setNotice("Copied"); } catch { setNotice("Select the text to copy manually."); } }}>Copy</Button>}<span className="type-caption text-secondary" role="status">{notice}</span></dd></div>;
}
export function PaymentDetails({ method, copyable = false }: { method: PaymentSnapshot | PlayerPaymentMethod; copyable?: boolean }) {
  return <div className="stack payment-details"><div><p className="type-caption text-secondary">{method.type === "UPI" ? "UPI payment" : "Bank transfer"}</p><h3 className="type-card-title">{method.displayName}</h3></div>
    {"qrImageId" in method && method.qrImageId && method.type === "UPI" && <PaymentImage key={method.qrImageId} src={`/api/deposits/proof/${encodeURIComponent(method.qrImageId)}`} alt={`Payment QR for ${method.displayName}`} qr />}
    <dl className="payment-facts">{method.type === "UPI" ? <CopyDetail title="UPI ID" value={method.upiId} copyable={copyable} /> : <>
      <CopyDetail title="Account holder" value={method.accountHolderName} copyable={copyable} /><CopyDetail title="Bank" value={method.bankName} copyable={copyable} />
      <CopyDetail title="Account number" value={"accountNumber" in method ? method.accountNumber : method.accountNumberMasked} copyable={copyable} /><CopyDetail title="IFSC" value={method.ifsc} copyable={copyable} />
    </>}</dl>{method.instructions && <p className="type-body-small payment-instructions">{method.instructions}</p>}
  </div>;
}
export function DepositStatus({ status }: { status: Deposit["status"] }) { return <Badge tone={status === "APPROVED" ? "success" : status === "REJECTED" ? "danger" : "warning"}>{status === "APPROVED" ? "Approved" : status === "REJECTED" ? "Rejected" : "Pending"}</Badge>; }
export function DepositAmounts({ requested, approved }: { requested: number; approved: number | null }) {
  return <dl className="deposit-amounts"><div><dt>Requested</dt><dd><Money paise={requested} /></dd></div>{approved !== null && <><div><dt>Approved</dt><dd><Money paise={approved} /></dd></div>{approved !== requested && <div className="deposit-difference"><dt>Difference</dt><dd><Money paise={approved - requested} showPositive /></dd></div>}</>}</dl>;
}
export function DepositRecord({ deposit, fullUtr = false }: { deposit: Deposit; fullUtr?: boolean }) {
  return <div className="stack deposit-record"><div className="between"><h3 className="type-card-title">{deposit.paymentMethodSnapshot.displayName}</h3><DepositStatus status={deposit.status} /></div>
    <DepositAmounts requested={deposit.requestedAmountPaise} approved={deposit.approvedAmountPaise} />
    <p className="type-body-small">UTR / reference: <span className="admin-reference">{fullUtr ? deposit.utr : maskedUtr(deposit.utr)}</span></p>
    <div className="type-caption text-secondary"><p>Submitted <BetTime value={deposit.submittedAt} /></p>{deposit.reviewedAt && <p>Reviewed <BetTime value={deposit.reviewedAt} /></p>}</div>
    {deposit.adminRemark && <p className="payment-instructions type-body-small"><strong>Admin remark:</strong> {deposit.adminRemark}</p>}
    {deposit.status === "PENDING" && <p className="type-caption text-secondary">Awaiting manual verification. Your balance changes only after approval.</p>}
  </div>;
}
