import { z } from "zod";
import { loginIdSchema, phoneSchema } from "@/modules/users/validators/identity";

export const portalSchema = z.enum(["PLAYER", "ADMIN"]);

export const loginRequestSchema = z.object({
  portal: portalSchema,
  loginId: loginIdSchema,
  password: z.string().min(1).max(1024),
}).strict();

export const otpRequestSchema = z.object({
  phone: phoneSchema,
}).strict();

export const otpVerifySchema = z.object({
  requestId: z.string().trim().min(1).max(64),
  code: z.string().regex(/^\d{6}$/),
}).strict();
