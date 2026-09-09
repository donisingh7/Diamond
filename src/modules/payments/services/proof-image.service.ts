import "server-only";
import { Types, type ClientSession } from "mongoose";
import { DomainError } from "@/lib/errors/domain-error";
import {
  ProofImage,
  PROOF_IMAGE_MAX_BYTES,
  proofImageContentTypes,
  type ProofImageContentType,
  type ProofImageKind,
  type ProofImageRow,
} from "../models/proof-image.model";

/**
 * Window 10A image store service — the only code that reads or writes {@link ProofImage} bytes.
 *
 *  - `parseImageUpload` turns a `multipart/form-data` POST into a validated `{ contentType,
 *    bytes }` pair: image MIME allow-list + a hard {@link PROOF_IMAGE_MAX_BYTES} ceiling,
 *    checked against `Content-Length` first (cheap reject) and the real byte length second.
 *  - `storeImage` persists one blob as BSON binary in its own collection — never a file on the
 *    (ephemeral, on Vercel) disk, never base64 in a business document.
 *  - `getImageForViewer` is the ONLY read path and always authorizes: a `QR` is public to any
 *    signed-in user (players must see it to pay); a `DEPOSIT_PROOF` is visible only to its
 *    owner or an admin. A miss and an unauthorized hit are the same `IMAGE_NOT_FOUND`.
 */

const HEX24 = /^[a-f0-9]{24}$/i;
const ALLOWED = new Set<string>(proofImageContentTypes);

export type StoreImageInput = {
  ownerId: Types.ObjectId;
  kind: ProofImageKind;
  contentType: ProofImageContentType;
  bytes: Buffer;
};

export type ImageViewer = { _id: Types.ObjectId; role: "PLAYER" | "ADMIN" };

export type ImagePayload = { contentType: ProofImageContentType; sizeBytes: number; bytes: Buffer };

function badImage(message: string): DomainError {
  return new DomainError("INVALID_IMAGE", message);
}

/** Validate + extract a single uploaded image from a multipart request. Does not persist. */
export async function parseImageUpload(request: Request): Promise<{ contentType: ProofImageContentType; bytes: Buffer }> {
  const declaredLength = Number(request.headers.get("content-length") ?? "");
  if (Number.isFinite(declaredLength) && declaredLength > PROOF_IMAGE_MAX_BYTES * 1.1) {
    throw badImage("Image exceeds the maximum allowed size.");
  }

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    throw badImage("Expected a multipart/form-data upload with a single 'file' field.");
  }

  const file = form.get("file");
  if (!(file instanceof File)) throw badImage("Missing 'file' in the upload.");
  if (!ALLOWED.has(file.type)) throw badImage("Only PNG, JPEG or WebP images are accepted.");
  if (file.size < 1) throw badImage("The uploaded image is empty.");
  if (file.size > PROOF_IMAGE_MAX_BYTES) throw badImage("Image exceeds the maximum allowed size.");

  const bytes = Buffer.from(await file.arrayBuffer());
  if (bytes.byteLength < 1 || bytes.byteLength > PROOF_IMAGE_MAX_BYTES) {
    throw badImage("Image exceeds the maximum allowed size.");
  }
  return { contentType: file.type as ProofImageContentType, bytes };
}

export async function storeImage(input: StoreImageInput): Promise<{ id: string; sizeBytes: number; contentType: ProofImageContentType }> {
  if (input.bytes.byteLength < 1 || input.bytes.byteLength > PROOF_IMAGE_MAX_BYTES) {
    throw badImage("Image exceeds the maximum allowed size.");
  }
  const [doc] = await ProofImage.create([
    {
      ownerId: input.ownerId,
      kind: input.kind,
      contentType: input.contentType,
      sizeBytes: input.bytes.byteLength,
      data: input.bytes,
    },
  ]);
  return { id: doc._id.toString(), sizeBytes: doc.sizeBytes, contentType: doc.contentType as ProofImageContentType };
}

/** Metadata-only load used when attaching a proof to a deposit request. Never projects bytes. */
export async function getProofImageMeta(imageId: string, session?: ClientSession): Promise<ProofImageRow> {
  if (!HEX24.test(imageId)) throw new DomainError("IMAGE_NOT_FOUND", "Image not found.");
  const query = ProofImage.findById(new Types.ObjectId(imageId)).select("-data");
  if (session) query.session(session);
  const row = await query.lean<ProofImageRow>();
  if (!row) throw new DomainError("IMAGE_NOT_FOUND", "Image not found.");
  return row;
}

/** Authorized byte read. `QR` → any signed-in viewer; `DEPOSIT_PROOF` → owner or admin. */
export async function getImageForViewer(imageId: string, viewer: ImageViewer): Promise<ImagePayload> {
  if (!HEX24.test(imageId)) throw new DomainError("IMAGE_NOT_FOUND", "Image not found.");
  const row = await ProofImage.findById(new Types.ObjectId(imageId)).select("+data").lean<ProofImageRow>();
  if (!row) throw new DomainError("IMAGE_NOT_FOUND", "Image not found.");

  const allowed = row.kind === "QR" || viewer.role === "ADMIN" || row.ownerId.equals(viewer._id);
  if (!allowed) throw new DomainError("IMAGE_NOT_FOUND", "Image not found.");

  const data = row.data as unknown as { buffer?: Buffer } | Buffer;
  const bytes = Buffer.isBuffer(data) ? data : Buffer.from((data.buffer ?? data) as Buffer);
  return { contentType: row.contentType as ProofImageContentType, sizeBytes: row.sizeBytes, bytes };
}
