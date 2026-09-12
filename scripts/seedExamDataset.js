const path = require("path");
require("dotenv").config({ path: path.join(__dirname, "..", ".env") });

const mongoose = require("mongoose");
const { seedExamDatasetV3, verifyExamDatasetV3 } = require("./examDatasetV3");

async function main() {
  if (!process.env.MONGO_URI) throw new Error("MONGO_URI mancante");
  await mongoose.connect(process.env.MONGO_URI);
  try {
    await seedExamDatasetV3();
    const verification = await verifyExamDatasetV3();
    if (!verification.ok) throw new Error(`Verifica dataset demo V3 fallita: ${JSON.stringify(verification.failures)}`);
    console.log(JSON.stringify({ status: "ok", dataset: "v3", ...verification.summary }, null, 2));
  } finally {
    await mongoose.disconnect();
  }
}

main().catch(async (error) => {
  console.error(error);
  await mongoose.disconnect().catch(() => {});
  process.exit(1);
});
