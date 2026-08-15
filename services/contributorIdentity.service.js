const crypto = require("crypto");
const AppError = require("../utils/AppError");

function contributorSecret() {
  const secret = process.env.ADAPTIVE_CONTRIBUTOR_SECRET;
  if (!secret || secret.length < 16) {
    throw new AppError("ADAPTIVE_CONTRIBUTOR_SECRET deve essere configurato per l'apprendimento collettivo", 503);
  }
  return secret;
}

function contributorHash(userId) {
  return crypto.createHmac("sha256", contributorSecret()).update(String(userId)).digest("hex");
}

module.exports = { contributorHash };
