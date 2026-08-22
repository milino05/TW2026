const path = require("path");
require("dotenv").config({ path: path.join(__dirname, "..", ".env") });

const mongoose = require("mongoose");
const { seedExamDataset, verifyExamDataset } = require("./examDatasetV2");

async function main() {
  if (!process.env.MONGO_URI) throw new Error("MONGO_URI mancante");
  await mongoose.connect(process.env.MONGO_URI);
  try {
    const seeded = await seedExamDataset();
    const verification = await verifyExamDataset();
    if (!verification.ok) throw new Error(`Verifica dataset fallita: ${JSON.stringify(verification.failures)}`);
    console.log(JSON.stringify({
      status: "ok",
      organizationId: String(seeded.organization._id),
      venueId: String(seeded.venue._id),
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
