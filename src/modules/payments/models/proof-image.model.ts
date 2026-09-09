import { Schema, type InferSchemaType, type HydratedDocument, type Types } from "mongoose";
import { modelFor, createdOnlyOptions, userRef } from "@/lib/db/schema";

/**
 * Window 10A image store — a deployable, Mongo-backed home for the two small binary blobs the
 * Add Money flow needs: an admin payment-method QR (`kind: "QR"`) and a player deposit proof
 * screenshot (`kind: "DEPOSIT_PROOF"`). Deployment target is Vercel, whose filesystem is
 * ephemeral, so uploads MUST NOT touch disk — they live here as BSON binary in their own
 * collection, never as base64 inside a business document.
 *
 * One image per document, hard-capped at {@link PROOF_IMAGE_MAX_BYTES} (well under the 16 MB
 * BSON limit) by the service before it ever constructs the doc. `data` is `select: false` so a
 * metadata read never drags the bytes along; only `proof-image.service.getImageBytes` projects
 * it, and only after an ownership / role check.
 */

export const proofImageKinds = ["QR", "DEPOSIT_PROOF"] as const;
export type ProofImageKind = (typeof proofImageKinds)[number];

/** 5 MiB. QR codes are a few KB; phone screenshots are typically < 2 MB. */
export const PROOF_IMAGE_MAX_BYTES = 5 * 1024 * 1024;

export const proofImageContentTypes = ["image/png", "image/jpeg", "image/webp"] as const;
export type ProofImageContentType = (typeof proofImageContentTypes)[number];

export const proofImageSchema = new Schema({
  /** Uploader. For `QR` this is the admin; for `DEPOSIT_PROOF` the player who owns it. */
  ownerId: userRef,
  kind: { type: String, enum: proofImageKinds, required: true, immutable: true },
  contentType: { type: String, enum: proofImageContentTypes, required: true, immutable: true },
  sizeBytes: { type: Number, required: true, min: 1, max: PROOF_IMAGE_MAX_BYTES, validate: Number.isSafeInteger, immutable: true },
  data: { type: Buffer, required: true, select: false, immutable: true },
}, createdOnlyOptions);
proofImageSchema.index({ ownerId: 1, createdAt: -1 });
proofImageSchema.index({ kind: 1, createdAt: -1 });

export type ProofImageRecord = InferSchemaType<typeof proofImageSchema>;
export type ProofImageDoc = HydratedDocument<ProofImageRecord>;
export type ProofImageRow = ProofImageRecord & { _id: Types.ObjectId; createdAt: Date };
export const ProofImage = modelFor("ProofImage", proofImageSchema, "proofImages");
