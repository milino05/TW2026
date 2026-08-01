const path = require("path");
require("dotenv").config({ path: path.join(__dirname, "..", ".env") });

const mongoose = require("mongoose");
const User = require("../models/user");
const Museum = require("../models/museum.model");

async function assignMuseumRole() {
  const [, , usernameArg, museumId, roleArg] = process.argv;
  const username = typeof usernameArg === "string" ? usernameArg.trim().toLowerCase() : "";
  const role = typeof roleArg === "string" ? roleArg.trim().toLowerCase() : "";

  if (
    !username ||
    !mongoose.isValidObjectId(museumId) ||
    !["operator", "manager"].includes(role)
  ) {
    throw new Error(
      "Uso: npm run assign:museum-role -- <username> <museumId> <operator|manager>",
    );
  }

  if (!process.env.MONGO_URI) throw new Error("MONGO_URI mancante");
  await mongoose.connect(process.env.MONGO_URI);

  const [user, museum] = await Promise.all([
    User.findOne({ username, status: "active" }),
    Museum.findById(museumId),
  ]);

  if (!user) throw new Error(`Utente non trovato o non attivo: ${username}`);
  if (!museum) throw new Error(`Museo non trovato: ${museumId}`);

  const membership = (user.memberships || []).find(
    (entry) => String(entry.museumId) === String(museumId),
  );

  if (membership) {
    membership.role = role;
  } else {
    user.memberships.push({ museumId, role });
  }

  await user.save();
  console.log(`${username} ha ruolo ${role} nel museo ${museum.name}`);
}

assignMuseumRole()
  .then(() => mongoose.disconnect())
  .catch(async (error) => {
    console.error(error.message || error);
    await mongoose.disconnect().catch(() => {});
    process.exit(1);
  });
