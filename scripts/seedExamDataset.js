const path = require("path");
require("dotenv").config({ path: path.join(__dirname, "..", ".env") });

const mongoose = require("mongoose");
const { seedExamDataset, verifyExamDataset } = require("./examDatasetV2");
const { seedAuroraDataset, verifyAuroraDataset } = require("./auroraDatasetV2");

async function main() {
  if (!process.env.MONGO_URI) throw new Error("MONGO_URI mancante");
  await mongoose.connect(process.env.MONGO_URI);
  try {
    const seeded = await seedExamDataset();
    const aurora = await seedAuroraDataset({ pinacotecaVisitRecords: seeded.visitRecords });
    const verification = await verifyExamDataset();
    const auroraVerification = await verifyAuroraDataset();
    if (!verification.ok) throw new Error(`Verifica dataset fallita: ${JSON.stringify(verification.failures)}`);
    if (!auroraVerification.ok) throw new Error(`Verifica dataset Aurora fallita: ${JSON.stringify(auroraVerification.failures)}`);
    console.log(JSON.stringify({
      status: "ok",
      organizationId: String(seeded.organization._id),
      venueId: String(seeded.venue._id),
      pinacoteca: verification.summary,
      aurora: {
        organizationId: String(aurora.organization._id),
        ...auroraVerification.summary,
      },
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
