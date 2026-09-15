const path = require("path");
require("dotenv").config({ path: path.join(__dirname, "..", ".env") });

const mongoose = require("mongoose");
const { migrateAllLegacyNavigatorConfigs } = require("../services/navigatorVenueConfig.service");

async function main() {
  if (!process.env.MONGO_URI) throw new Error("MONGO_URI mancante");
  await mongoose.connect(process.env.MONGO_URI);
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
}

main().catch(async (error) => {
  console.error(error);
  await mongoose.disconnect().catch(() => {});
  process.exit(1);
});
