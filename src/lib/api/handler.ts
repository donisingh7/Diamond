import "server-only";
import { NextResponse, type NextRequest } from "next/server";
import { ZodError } from "zod";
import { toPublicError, httpStatusForError } from "@/lib/errors/domain-error";

/**
 * Thin route-handler wrapper: parse/domain errors become the shared {error:{code,message}} shape.
 * Never leaks raw Mongo/Zod detail. The extra args carry Next's route context (e.g. `{ params }`)
 * through to dynamic-segment handlers unchanged.
 */
export function apiRoute<Args extends unknown[]>(handler: (request: NextRequest, ...args: Args) => Promise<NextResponse>) {
  return async (request: NextRequest, ...args: Args): Promise<NextResponse> => {
    try {
      return await handler(request, ...args);
    } catch (error) {
      if (error instanceof ZodError) {
        return NextResponse.json({ error: { code: "INVALID_INPUT", message: "Invalid request." } }, { status: 400 });
      }
      return NextResponse.json({ error: toPublicError(error) }, { status: httpStatusForError(error) });
    }
  };
}
