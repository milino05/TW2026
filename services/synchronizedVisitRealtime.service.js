const mongoose = require("mongoose");
const { Server } = require("socket.io");
const authService = require("./auth.service");
const { getSessionToken } = require("../middlewares/auth");
const { configuredOrigins } = require("../middlewares/originGuard");
const { loadMembershipRuntime } = require("./synchronizedVisitSession.service");

let io = null;
const presenceBySession = new Map();

function roomName(sessionId) { return `synchronized-visit:${String(sessionId)}`; }
function sessionPresence(sessionId) {
  const key = String(sessionId);
  if (!presenceBySession.has(key)) presenceBySession.set(key, new Map());
  return presenceBySession.get(key);
}
function onlineUserIds(sessionId) {
  return [...(presenceBySession.get(String(sessionId))?.entries() || [])]
    .filter(([, connections]) => connections > 0)
    .map(([userId]) => userId);
}

function changePresence({ sessionId, userId, delta }) {
  const presence = sessionPresence(sessionId);
  const key = String(userId);
  const previous = presence.get(key) || 0;
  const next = Math.max(0, previous + delta);
  if (next) presence.set(key, next); else presence.delete(key);
  if (!presence.size) presenceBySession.delete(String(sessionId));
  return { changed: (previous === 0) !== (next === 0), online: next > 0 };
}

function notifySynchronizedVisitChanged({ synchronizedSessionId, runtimeVersion }) {
  if (!io) return;
  io.to(roomName(synchronizedSessionId)).emit("synchronized:invalidated", {
    sessionId: String(synchronizedSessionId),
    runtimeVersion: Number(runtimeVersion) || null,
  });
}

function initializeSynchronizedVisitRealtime(httpServer) {
  const origins = configuredOrigins();
  io = new Server(httpServer, {
    ...(origins.length ? { cors: { origin: origins, credentials: true } } : {}),
  });
  io.use(async (socket, next) => {
    try {
      const token = getSessionToken({ headers: socket.handshake.headers || {} });
      const resolved = token ? await authService.resolveSession(token) : null;
      if (!resolved?.user) return next(new Error("AUTHENTICATION_REQUIRED"));
      socket.data.userId = String(resolved.user._id);
      return next();
    } catch (error) { return next(error); }
  });
  io.on("connection", (socket) => {
    socket.on("synchronized:subscribe", async (payload = {}, acknowledge = () => {}) => {
      const sessionId = String(payload.sessionId || "");
      if (!mongoose.isValidObjectId(sessionId)) return acknowledge({ ok: false, code: "INVALID_SESSION_ID" });
      try {
        await loadMembershipRuntime({ synchronizedSessionId: sessionId, userId: socket.data.userId });
        const previousSessionId = socket.data.synchronizedSessionId || null;
        if (previousSessionId && previousSessionId !== sessionId) {
          socket.leave(roomName(previousSessionId));
          const previous = changePresence({ sessionId: previousSessionId, userId: socket.data.userId, delta: -1 });
          if (previous.changed) io.to(roomName(previousSessionId)).emit("synchronized:presence", { sessionId: previousSessionId, userId: socket.data.userId, online: false });
        }
        if (previousSessionId !== sessionId) {
          socket.join(roomName(sessionId));
          socket.data.synchronizedSessionId = sessionId;
          const current = changePresence({ sessionId, userId: socket.data.userId, delta: 1 });
          if (current.changed) io.to(roomName(sessionId)).emit("synchronized:presence", { sessionId, userId: socket.data.userId, online: true });
        }
        return acknowledge({ ok: true, sessionId, onlineUserIds: onlineUserIds(sessionId) });
      } catch (error) {
        return acknowledge({ ok: false, code: error?.details?.[0]?.code || "MEMBERSHIP_REQUIRED" });
      }
    });
    socket.on("disconnect", () => {
      const sessionId = socket.data.synchronizedSessionId;
      if (!sessionId) return;
      const current = changePresence({ sessionId, userId: socket.data.userId, delta: -1 });
      if (current.changed) io.to(roomName(sessionId)).emit("synchronized:presence", { sessionId, userId: socket.data.userId, online: false });
    });
  });
  return io;
}

module.exports = {
  initializeSynchronizedVisitRealtime,
  notifySynchronizedVisitChanged,
  onlineUserIds,
  roomName,
};
