const crypto = require("crypto");
const { promisify } = require("util");

const User = require("../models/user");
const Session = require("../models/session");
const AppError = require("../utils/AppError");

const scryptAsync = promisify(crypto.scrypt);
const PASSWORD_KEY_LENGTH = 64;
const SESSION_TOKEN_BYTES = 32;
const DEFAULT_SESSION_HOURS = 168;

function getSessionDurationMs() {
  const configuredHours = Number(process.env.SESSION_DURATION_HOURS);
  const hours = Number.isFinite(configuredHours) && configuredHours > 0 ? configuredHours : DEFAULT_SESSION_HOURS;
  return hours * 60 * 60 * 1000;
}

function normalizeUsername(username) {
  return typeof username === "string" ? username.trim().toLowerCase() : username;
}

function validatePlainPassword(password) {
  if (typeof password !== "string" || password.length < 8) {
    throw new AppError("Password non valida", 400, [
      {
        field: "password",
        code: "INVALID_PASSWORD",
        message: "La password deve contenere almeno 8 caratteri",
      },
    ]);
  }
}

async function hashPassword(password) {
  validatePlainPassword(password);

  const salt = crypto.randomBytes(16);
  const derivedKey = await scryptAsync(password, salt, PASSWORD_KEY_LENGTH);

  return `scrypt$${salt.toString("hex")}$${Buffer.from(derivedKey).toString("hex")}`;
}

async function verifyPassword(password, encodedHash) {
  if (typeof password !== "string" || typeof encodedHash !== "string") {
    return false;
  }

  const [algorithm, saltHex, hashHex] = encodedHash.split("$");

  if (algorithm !== "scrypt" || !saltHex || !hashHex) {
    return false;
  }

  const expectedHash = Buffer.from(hashHex, "hex");
  const actualHash = Buffer.from(
    await scryptAsync(password, Buffer.from(saltHex, "hex"), expectedHash.length),
  );

  return expectedHash.length === actualHash.length && crypto.timingSafeEqual(expectedHash, actualHash);
}

function hashSessionToken(token) {
  return crypto.createHash("sha256").update(token).digest("hex");
}

async function registerUser({ username, password }) {
  const normalizedUsername = normalizeUsername(username);

  if (!normalizedUsername || typeof normalizedUsername !== "string") {
    throw new AppError("Username non valido", 400, [
      { field: "username", code: "REQUIRED", message: "username e obbligatorio" },
    ]);
  }

  validatePlainPassword(password);

  const alreadyExists = await User.exists({ username: normalizedUsername });
  if (alreadyExists) {
    throw new AppError("Username gia utilizzato", 409, [
      { field: "username", code: "DUPLICATE_USERNAME", message: "username gia utilizzato" },
    ]);
  }

  const user = new User({
    username: normalizedUsername,
    passwordHash: await hashPassword(password),
    memberships: [],
    status: "active",
  });

  await user.save();
  return user;
}

async function authenticateUser({ username, password }) {
  const normalizedUsername = normalizeUsername(username);
  const user = await User.findOne({ username: normalizedUsername }).select("+passwordHash");

  const isValid = user ? await verifyPassword(password, user.passwordHash) : false;

  if (!user || !isValid || user.status !== "active") {
    throw new AppError("Credenziali non valide", 401);
  }

  return user;
}

async function createSession({ userId, userAgent, ipAddress }) {
  const token = crypto.randomBytes(SESSION_TOKEN_BYTES).toString("base64url");
  const expiresAt = new Date(Date.now() + getSessionDurationMs());

  await Session.create({
    userId,
    tokenHash: hashSessionToken(token),
    expiresAt,
    lastUsedAt: new Date(),
    userAgent,
    ipAddress,
  });

  return { token, expiresAt };
}

async function resolveSession(token) {
  if (!token || typeof token !== "string") {
    return null;
  }

  const session = await Session.findOne({
    tokenHash: hashSessionToken(token),
    expiresAt: { $gt: new Date() },
  }).lean();

  if (!session) {
    return null;
  }

  const user = await User.findOne({ _id: session.userId, status: "active" }).lean();
  if (!user) {
    await Session.deleteOne({ _id: session._id });
    return null;
  }

  const fifteenMinutesAgo = Date.now() - 15 * 60 * 1000;
  if (!session.lastUsedAt || new Date(session.lastUsedAt).getTime() < fifteenMinutesAgo) {
    await Session.updateOne({ _id: session._id }, { $set: { lastUsedAt: new Date() } });
  }

  return { user, session };
}

async function revokeSession(token) {
  if (!token || typeof token !== "string") {
    return;
  }

  await Session.deleteOne({ tokenHash: hashSessionToken(token) });
}

module.exports = {
  getSessionDurationMs,
  normalizeUsername,
  hashPassword,
  verifyPassword,
  registerUser,
  authenticateUser,
  createSession,
  resolveSession,
  revokeSession,
};
