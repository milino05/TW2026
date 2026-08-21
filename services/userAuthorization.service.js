const User = require("../models/user");
const AppError = require("../utils/AppError");

async function getActiveUserOrFail(userId) {
  const user = await User.findOne({ _id: userId, status: "active" });
  if (!user) throw new AppError("Utente non autorizzato", 403);
  return user;
}

module.exports = { getActiveUserOrFail };
