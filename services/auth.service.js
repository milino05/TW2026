const crypto = require("crypto");
const { promisify } = require("util");
const mongoose = require("mongoose");

const User = require("../models/user");
const Session = require("../models/session");
const AppError = require("../utils/AppError");
const { ensurePrincipalContentSpace } = require("./contentSpaceBootstrap.service");

const scryptAsync = promisify(crypto.scrypt);
const PASSWORD_KEY_LENGTH = 64;
const SCRYPT_N = 16384;
const SCRYPT_R = 8;
const SCRYPT_P = 1;
const SCRYPT_MAX_MEMORY = 64 * 1024 * 1024;
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
  if (typeof password !== "string" || password.length < 8 || password.length > 128) {
    throw new AppError("Password non valida", 400, [
      {
        field: "password",
        code: "INVALID_PASSWORD",
        message: "La password deve contenere tra 8 e 128 caratteri",
      },
    ]);
  }
}

function scryptOptions({ N = SCRYPT_N, r = SCRYPT_R, p = SCRYPT_P } = {}) {
  return { N, r, p, maxmem: SCRYPT_MAX_MEMORY };
}

async function hashPassword(password) {
  validatePlainPassword(password);

  const salt = crypto.randomBytes(16);
  const derivedKey = await scryptAsync(
    password,
    salt,
    PASSWORD_KEY_LENGTH,
    scryptOptions(),
  );

  return [
    "scrypt",
    SCRYPT_N,
    SCRYPT_R,
    SCRYPT_P,
    salt.toString("hex"),
    Buffer.from(derivedKey).toString("hex"),
  ].join("$");
}

async function verifyPassword(password, encodedHash) {
  if (typeof password !== "string" || typeof encodedHash !== "string") return false;

  const [algorithm, nText, rText, pText, saltHex, hashHex] = encodedHash.split("$");
  const N = Number(nText);
  const r = Number(rText);
  const p = Number(pText);

  if (
    algorithm !== "scrypt" ||
    !Number.isInteger(N) ||
    !Number.isInteger(r) ||
    !Number.isInteger(p) ||
    !saltHex ||
    !hashHex
  ) {
    return false;
  }

  try {
    const expectedHash = Buffer.from(hashHex, "hex");
    if (expectedHash.length === 0) return false;

    const actualHash = Buffer.from(
      await scryptAsync(
        password,
        Buffer.from(saltHex, "hex"),
        expectedHash.length,
        scryptOptions({ N, r, p }),
      ),
    );

    return expectedHash.length === actualHash.length && crypto.timingSafeEqual(expectedHash, actualHash);
  } catch {
    return false;
  }
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

  if (await User.exists({ username: normalizedUsername })) {
    throw new AppError("Username gia utilizzato", 409, [
      { field: "username", code: "DUPLICATE_USERNAME", message: "username gia utilizzato" },
    ]);
  }

  const passwordHash = await hashPassword(password);
  let user = null;
  try {
    await mongoose.connection.transaction(async (session) => {
      user = new User({
        username: normalizedUsername,
        passwordHash,
        status: "active",
      });
      await user.save({ session });
      await ensurePrincipalContentSpace({
        ownerType: "user",
        ownerId: user._id,
        principalLabel: user.username,
        actorUserId: user._id,
        session,
      });
    });
  } catch (error) {
    if (error?.code === 11000) {
      throw new AppError("Username gia utilizzato", 409, [
        { field: "username", code: "DUPLICATE_USERNAME", message: "username gia utilizzato" },
      ]);
    }
    throw error;
  }
  return user;
}

async function authenticateUser({ username, password }) {
  const normalizedUsername = normalizeUsername(username);
  const user = await User.findOne({ username: normalizedUsername }).select("+passwordHash");

  // Anche per username inesistenti viene eseguito scrypt per ridurre differenze temporali evidenti.
  const hashToVerify = user?.passwordHash || `scrypt$${SCRYPT_N}$${SCRYPT_R}$${SCRYPT_P}$${"00".repeat(16)}$${"00".repeat(PASSWORD_KEY_LENGTH)}`;
  const isValid = await verifyPassword(password, hashToVerify);

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
  if (!token || typeof token !== "string") return null;

  const session = await Session.findOne({
    tokenHash: hashSessionToken(token),
    expiresAt: { $gt: new Date() },
  }).lean();

  if (!session) return null;

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
  if (!token || typeof token !== "string") return;
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
