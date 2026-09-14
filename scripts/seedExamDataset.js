const path = require("path");
require("dotenv").config({ path: path.join(__dirname, "..", ".env") });

const mongoose = require("mongoose");
const {
  hasDemoDatabaseSnapshot,
  restoreDemoDatabaseSnapshot,
} = require("./demoDatabaseSnapshot");

async function main() {
  if (!process.env.MONGO_URI) throw new Error("MONGO_URI mancante");
  await mongoose.connect(process.env.MONGO_URI);
  try {
    const snapshotAvailable = await hasDemoDatabaseSnapshot();
    let dataset;
    let restored = null;

    if (snapshotAvailable) {
      restored = await restoreDemoDatabaseSnapshot();
      dataset = "snapshot-v1";
    } else {
      const { seedExamDatasetV3 } = require("./examDatasetV3");
      await seedExamDatasetV3();
      dataset = "v3";
    }

    const { verifyExamDatasetV3 } = require("./examDatasetV3");
    const verification = await verifyExamDatasetV3();
    if (!verification.ok) {
      throw new Error(`Verifica dataset demo fallita: ${JSON.stringify(verification.failures)}`);
    }
    console.log(JSON.stringify({
      status: "ok",
      dataset,
      ...(restored ? { restored } : {}),
      ...verification.summary,
    }, null, 2));
  } finally {
    await mongoose.disconnect();
  }
}

main().catch(async (error) => {
  console.error(error);
  await mongoose.disconnect().catch(() => {});
  process.exit(1);
});
