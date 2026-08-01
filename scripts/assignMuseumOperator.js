const path = require("path");
require("dotenv").config({ path: path.join(__dirname, "..", ".env") });

const mongoose = require("mongoose");
const User = require("../models/user");
const Museum = require("../models/museum.model");

async function assignMuseumOperator() {
  const [, , usernameArg, museumId] = process.argv;
  const username = typeof usernameArg === "string" ? usernameArg.trim().toLowerCase() : "";

  if (!username || !mongoose.isValidObjectId(museumId)) {
    throw new Error("Uso: npm run assign:operator -- <username> <museumId>");
  }

  if (!process.env.MONGO_URI) throw new Error("MONGO_URI mancante");
  await mongoose.connect(process.env.MONGO_URI);

  const [user, museum] = await Promise.all([
    User.findOne({ username }),
    Museum.findById(museumId),
  ]);

  if (!user) throw new Error(`Utente non trovato: ${username}`);
  if (!museum) throw new Error(`Museo non trovato: ${museumId}`);

  const alreadyAssigned = (user.memberships || []).some(
    (membership) => String(membership.museumId) === String(museumId),
  );

  if (!alreadyAssigned) {
    user.memberships.push({ museumId, role: "operator" });
    await user.save();
  }

  console.log(`${username} e operatore del museo ${museum.name}`);
}

assignMuseumOperator()
  .then(() => mongoose.disconnect())
  .catch(async (error) => {
    console.error(error.message || error);
    await mongoose.disconnect().catch(() => {});
    process.exit(1);
  });
