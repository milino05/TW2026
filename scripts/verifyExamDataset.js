const path = require("path");
require("dotenv").config({ path: path.join(__dirname, "..", ".env") });

const mongoose = require("mongoose");
const { verifyExamDataset } = require("./examDatasetV2");
const { verifyAuroraDataset } = require("./auroraDatasetV2");

async function main() {
  if (!process.env.MONGO_URI) throw new Error("MONGO_URI mancante");
  await mongoose.connect(process.env.MONGO_URI);
  try {
    const pinacoteca = await verifyExamDataset();
    const aurora = await verifyAuroraDataset();
    const result = { ok: pinacoteca.ok && aurora.ok, pinacoteca, aurora };
    console.log(JSON.stringify(result, null, 2));
    if (!result.ok) process.exitCode = 1;
  } finally {
    await mongoose.disconnect();
  }
}

main().catch(async (error) => {
  console.error(error);
  await mongoose.disconnect().catch(() => {});
  process.exit(1);
});
