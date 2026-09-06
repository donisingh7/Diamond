import type { Types } from "mongoose";

/** Window 7: resumable batches; each bet atomic with its optional win credit. */
export interface SettlementService {
  settleBatch(roundId: Types.ObjectId, batchSize: number): Promise<{ processed: number; complete: boolean }>;
}
