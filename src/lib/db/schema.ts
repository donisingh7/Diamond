import "server-only";
import mongoose, { Schema, type Model } from "mongoose";

export function modelFor<T>(name: string, schema: Schema<T>, collection: string): Model<T> {
  return mongoose.models[name] ? mongoose.model<T>(name) : mongoose.model<T>(name, schema, collection);
}

export const schemaOptions = { timestamps: true, strict: "throw", optimisticConcurrency: true } as const;
export const createdOnlyOptions = { timestamps: { createdAt: true, updatedAt: false }, strict: "throw" } as const;
export const requiredText = { type: String, required: true, trim: true } as const;
export const integer = { type: Number, required: true, validate: Number.isSafeInteger } as const;
export const nonnegativeInteger = { ...integer, min: 0 } as const;
export const paise = nonnegativeInteger;
export const positivePaise = { ...paise, min: 100 } as const;
export const twoDigit = {
  type: String, match: /^\d{2}$/,
  set: (value: unknown) => { if (typeof value !== "string") throw new Error("Two-digit numbers must be strings."); return value; },
} as const;
export const userRef = { type: Schema.Types.ObjectId, ref: "User", required: true } as const;
export const optionalUserRef = { type: Schema.Types.ObjectId, ref: "User" } as const;
