import "server-only";
import { PlatformSettings } from "../models/platform-settings.model";
import { Market } from "@/modules/markets/models/market.model";
import { marketDefaults, platformDefaults } from "../seed-data";

export async function seedFoundation(): Promise<void> {
  await new PlatformSettings(platformDefaults).validate();
  await PlatformSettings.updateOne({ key: platformDefaults.key }, { $setOnInsert: platformDefaults }, { upsert: true, runValidators: true });
  for (const defaults of marketDefaults) {
    await new Market(defaults).validate();
    await Market.updateOne({ slug: defaults.slug }, { $setOnInsert: defaults }, { upsert: true, runValidators: true });
  }
}
