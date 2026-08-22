const authService = require("../services/auth.service");
const {
  SESSION_COOKIE_NAME,
  getSessionToken,
  getSessionCookieOptions,
} = require("../middlewares/auth");

function publicUser(user) {
  return {
    _id: user._id,
    username: user.username,
    organizationMemberships: user.organizationMemberships || [],
    status: user.status,
    createdAt: user.createdAt,
    updatedAt: user.updatedAt,
  };
}

async function startAuthenticatedSession({ req, res, user }) {
  const session = await authService.createSession({
    userId: user._id,
    userAgent: req.get("user-agent"),
    ipAddress: req.ip,
  });

  res.cookie(SESSION_COOKIE_NAME, session.token, getSessionCookieOptions());

  return {
    user: publicUser(user),
    sessionExpiresAt: session.expiresAt,
  };
}

async function register(req, res, next) {
  try {
    const user = await authService.registerUser({
      username: req.body?.username,
      password: req.body?.password,
    });

    const response = await startAuthenticatedSession({ req, res, user });
    res.status(201).json(response);
  } catch (error) {
    next(error);
  }
}

async function login(req, res, next) {
  try {
    const user = await authService.authenticateUser({
      username: req.body?.username,
      password: req.body?.password,
    });

    const response = await startAuthenticatedSession({ req, res, user });
    res.status(200).json(response);
  } catch (error) {
    next(error);
  }
}

async function logout(req, res, next) {
  try {
    await authService.revokeSession(getSessionToken(req));

    const { maxAge, ...clearCookieOptions } = getSessionCookieOptions();
    res.clearCookie(SESSION_COOKIE_NAME, clearCookieOptions);
    res.status(204).send();
  } catch (error) {
    next(error);
  }
}

function me(req, res) {
  res.status(200).json({ user: publicUser(req.user) });
}

module.exports = {
  register,
  login,
  logout,
  me,
};
