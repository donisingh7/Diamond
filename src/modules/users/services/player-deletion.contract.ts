import type { Types } from "mongoose";

/** Window 6: coordinated write exclusion and complete identifying-data purge. */
export interface PlayerDeletionService {
  purgePlayer(input: { actorAdminId: Types.ObjectId; playerId: Types.ObjectId }): Promise<void>;
}
