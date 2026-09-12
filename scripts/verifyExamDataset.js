const path = require("path");
require("dotenv").config({ path: path.join(__dirname, "..", ".env") });

const mongoose = require("mongoose");
const { verifyExamDatasetV3 } = require("./examDatasetV3");

async function main() {
  if (!process.env.MONGO_URI) throw new Error("MONGO_URI mancante");
  await mongoose.connect(process.env.MONGO_URI);
  try {
    const verification = await verifyExamDatasetV3();
    if (!verification.ok) {
      console.error(JSON.stringify(verification, null, 2));
      process.exitCode = 1;
      return;
    }
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
