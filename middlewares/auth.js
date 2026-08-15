const authService = require("../services/auth.service");
const AppError = require("../utils/AppError");

const SESSION_COOKIE_NAME = "artaround_session";

function parseCookies(cookieHeader = "") {
  return cookieHeader.split(";").reduce((cookies, part) => {
    const separatorIndex = part.indexOf("=");
    if (separatorIndex < 0) return cookies;

    const key = part.slice(0, separatorIndex).trim();
    const value = part.slice(separatorIndex + 1).trim();

    if (key) cookies[key] = value;
    return cookies;
  }, {});
}

function getSessionToken(req) {
  return parseCookies(req.headers.cookie || "")[SESSION_COOKIE_NAME] || null;
}

async function loadCurrentUser(req, res, next) {
  try {
    req.user = null;
    req.authSession = null;

    const token = getSessionToken(req);
    if (!token) return next();

    const resolved = await authService.resolveSession(token);
    if (resolved) {
      req.user = resolved.user;
      req.authSession = resolved.session;
    }

    return next();
  } catch (error) {
    return next(error);
  }
}

function requireAuth(req, res, next) {
  if (!req.user) return next(new AppError("Autenticazione richiesta", 401));
  return next();
}

function getSessionCookieOptions() {
  const secure = process.env.SESSION_COOKIE_SECURE === "true" || process.env.NODE_ENV === "production";

  return {
    httpOnly: true,
    secure,
    sameSite: "lax",
    path: "/",
    maxAge: authService.getSessionDurationMs(),
  };
}

module.exports = {
  SESSION_COOKIE_NAME,
  getSessionToken,
  getSessionCookieOptions,
  loadCurrentUser,
  requireAuth,
};
