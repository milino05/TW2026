const mongoose = require("mongoose");
const connectDB = require("../config/database");
const { migrateAllLegacyNavigatorConfigs } = require("../services/navigatorVenueConfig.service");

(async () => {
  await connectDB();
  try {
    const results = await migrateAllLegacyNavigatorConfigs();
    const migrated = results.filter((entry) => entry.status === "migrated").length;
    const alreadyV3 = results.filter((entry) => entry.status === "already_v3").length;
    console.log(`Navigator config v3: ${migrated} migrate, ${alreadyV3} già v3, ${results.length} controllate.`);
    for (const entry of results.filter((result) => !["migrated", "already_v3"].includes(result.status))) {
      console.log(`- ${entry.venueId}: ${entry.status}`);
    }
  } finally {
    await mongoose.disconnect();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
