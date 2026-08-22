const path = require("path");
require("dotenv").config({ path: path.join(__dirname, "..", ".env") });

const mongoose = require("mongoose");
const { ensureRequiredUsers, REQUIRED_USERNAMES } = require("./examDatasetV2");

async function main() {
  if (!process.env.MONGO_URI) throw new Error("MONGO_URI mancante");
  await mongoose.connect(process.env.MONGO_URI);
  try {
    await ensureRequiredUsers();
    for (const username of REQUIRED_USERNAMES) console.log(`Account richiesto pronto: ${username}`);
  } finally {
    await mongoose.disconnect();
  }
}

main().catch(async (error) => {
  console.error(error);
  await mongoose.disconnect().catch(() => {});
  process.exit(1);
});
