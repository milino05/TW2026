const path = require("path");
require("dotenv").config({ path: path.join(__dirname, "..", ".env") });

const mongoose = require("mongoose");
const User = require("../models/user");
const { hashPassword } = require("../services/auth.service");

const REQUIRED_USERNAMES = ["autore1", "autore2", "visitatore1", "visitatore2"];
const DEFAULT_PASSWORD = "12345678";

async function seedRequiredUsers() {
  if (!process.env.MONGO_URI) {
    throw new Error("MONGO_URI mancante");
  }

  await mongoose.connect(process.env.MONGO_URI);
  const passwordHash = await hashPassword(DEFAULT_PASSWORD);

  for (const username of REQUIRED_USERNAMES) {
    const existingUser = await User.findOne({ username });

    if (existingUser) {
      existingUser.passwordHash = passwordHash;
      existingUser.status = "active";
      await existingUser.save();
      console.log(`Aggiornato utente ${username}`);
    } else {
      await User.create({
        username,
        passwordHash,
        memberships: [],
        status: "active",
      });
      console.log(`Creato utente ${username}`);
    }
  }
}

seedRequiredUsers()
  .then(() => mongoose.disconnect())
  .catch(async (error) => {
    console.error(error);
    await mongoose.disconnect().catch(() => {});
    process.exit(1);
  });
