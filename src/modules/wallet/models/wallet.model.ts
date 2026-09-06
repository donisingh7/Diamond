import { Schema } from "mongoose";
import { modelFor, schemaOptions, userRef, paise } from "@/lib/db/schema";

export const walletSchema = new Schema({
  userId: userRef,
  currency: { type: String, enum: ["INR"], default: "INR", required: true },
  availableBalancePaise: { ...paise, default: 0 },
  reservedBalancePaise: { ...paise, default: 0 },
}, schemaOptions);
walletSchema.index({ userId: 1 }, { unique: true });
export const Wallet = modelFor("Wallet", walletSchema, "wallets");
