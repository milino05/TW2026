const path = require("path");
require("dotenv").config({ path: path.join(__dirname, "..", ".env") });

const mongoose = require("mongoose");
const { enrichExamPresentationMatrix, verifyExamPresentationMatrix } = require("./examPresentationMatrix");

async function main() {
  if (!process.env.MONGO_URI) throw new Error("MONGO_URI mancante");
  await mongoose.connect(process.env.MONGO_URI);
  try {
    const enriched = await enrichExamPresentationMatrix();
    const verification = await verifyExamPresentationMatrix();
    if (!verification.ok) throw new Error(`Verifica matrice presentation fallita: ${JSON.stringify(verification.failures)}`);
    console.log(JSON.stringify({ status: "ok", ...enriched, ...verification.summary }, null, 2));
  } finally {
    await mongoose.disconnect();
  }
}

main().catch(async (error) => {
  console.error(error);
  await mongoose.disconnect().catch(() => {});
  process.exit(1);
});
