const AppError = require("../utils/AppError");

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

function configuredOrigins() {
  return (process.env.CORS_ORIGINS || "")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);
}

function requireTrustedOrigin(req, res, next) {
  if (SAFE_METHODS.has(req.method)) return next();

  const origin = req.get("origin");
  if (!origin) return next();

  const requestOrigin = `${req.protocol}://${req.get("host")}`;
  const allowedOrigins = configuredOrigins();

  if (origin === requestOrigin || allowedOrigins.includes(origin)) {
    return next();
  }

  return next(new AppError("Origin della richiesta non consentita", 403));
}

module.exports = {
  configuredOrigins,
  requireTrustedOrigin,
};
