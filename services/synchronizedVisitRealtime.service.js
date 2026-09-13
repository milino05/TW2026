const mongoose = require("mongoose");
const { Server } = require("socket.io");
const VisitSessionV2 = require("../models/visitSessionV2.model");
const authService = require("./auth.service");
const { getSessionToken } = require("../middlewares/auth");
const { configuredOrigins } = require("../middlewares/originGuard");
const { loadMembershipRuntime } = require("./synchronizedVisitSession.service");

let io = null;
const presenceBySession = new Map();
const ACTIVE_MODES = new Set(["reading", "audio"]);

function roomName(sessionId) { return `synchronized-visit:${String(sessionId)}`; }
function sessionPresence(sessionId) {
  const key = String(sessionId);
  if (!presenceBySession.has(key)) presenceBySession.set(key, new Map());
  return presenceBySession.get(key);
}

function normalizeParticipantActivity(payload = {}) {
  const mode = payload.activity === "active" && ACTIVE_MODES.has(payload.mode) ? payload.mode : null;
  return { activity: mode ? "active" : "inactive", mode };
}

function aggregateConnectionActivity(connections) {
  const states = [...connections.values()];
  const activeStates = states.filter((state) => state.activity === "active");
  if (!activeStates.length) return { activity: "inactive", mode: null };
  return {
    activity: "active",
    mode: activeStates.some((state) => state.mode === "audio") ? "audio" : "reading",
  };
}

function projectedPresence(userId, entry, changedAt = null) {
  if (!entry?.connections?.size) {
    return {
      userId: String(userId),
      online: false,
      activity: "inactive",
      mode: null,
      changedAt,
    };
  }
  const aggregated = aggregateConnectionActivity(entry.connections);
  return {
    userId: String(userId),
    online: true,
    activity: aggregated.activity,
    mode: aggregated.mode,
    changedAt: entry.changedAt || changedAt,
  };
}

function presenceChanged(previous, next) {
  return previous.online !== next.online
    || previous.activity !== next.activity
    || previous.mode !== next.mode;
}

function mutatePresenceConnection({ sessionId, userId, socketId, nextActivity = null, remove = false }) {
  const sessionKey = String(sessionId);
  const userKey = String(userId);
  const presence = sessionPresence(sessionKey);
  let entry = presence.get(userKey) || null;
  const previous = projectedPresence(userKey, entry);

  if (!entry && !remove) {
    entry = { connections: new Map(), changedAt: new Date().toISOString() };
    presence.set(userKey, entry);
  }
  if (!entry) return { changed: false, state: previous };

  if (remove) {
    entry.connections.delete(String(socketId));
  } else if (nextActivity) {
    if (!entry.connections.has(String(socketId))) return { changed: false, state: previous };
    entry.connections.set(String(socketId), normalizeParticipantActivity(nextActivity));
  } else {
    entry.connections.set(String(socketId), { activity: "inactive", mode: null });
  }

  const now = new Date().toISOString();
  const provisional = projectedPresence(userKey, entry, now);
  const changed = presenceChanged(previous, provisional);
  if (changed && entry.connections.size) entry.changedAt = now;
  const state = entry.connections.size
    ? projectedPresence(userKey, entry, now)
    : projectedPresence(userKey, null, now);

  if (!entry.connections.size) presence.delete(userKey);
  if (!presence.size) presenceBySession.delete(sessionKey);
  return { changed, state };
}

function presenceSnapshot(sessionId) {
  return [...(presenceBySession.get(String(sessionId))?.entries() || [])]
    .map(([userId, entry]) => projectedPresence(userId, entry));
}

function onlineUserIds(sessionId) {
  return presenceSnapshot(sessionId).filter((entry) => entry.online).map((entry) => entry.userId);
}

function emitPresence(sessionId, state) {
  if (!io || !state) return;
  io.to(roomName(sessionId)).emit("synchronized:presence", {
    sessionId: String(sessionId),
    ...state,
  });
}

function notifySynchronizedVisitChanged({ synchronizedSessionId, runtimeVersion }) {
  if (!io) return;
  io.to(roomName(synchronizedSessionId)).emit("synchronized:invalidated", {
    sessionId: String(synchronizedSessionId),
    runtimeVersion: Number(runtimeVersion) || null,
  });
}

async function notifySynchronizedVisitChangedForVisitSession({ visitSessionId, userId }) {
  const session = await VisitSessionV2.findOne({ _id: visitSessionId, userId })
    .select("synchronizedSessionId")
    .lean();
  if (!session?.synchronizedSessionId) return false;
  notifySynchronizedVisitChanged({
    synchronizedSessionId: session.synchronizedSessionId,
    runtimeVersion: null,
  });
  return true;
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
          const previous = mutatePresenceConnection({
            sessionId: previousSessionId,
            userId: socket.data.userId,
            socketId: socket.id,
            remove: true,
          });
          if (previous.changed) emitPresence(previousSessionId, previous.state);
        }
        if (previousSessionId !== sessionId) {
          socket.join(roomName(sessionId));
          socket.data.synchronizedSessionId = sessionId;
          const current = mutatePresenceConnection({
            sessionId,
            userId: socket.data.userId,
            socketId: socket.id,
          });
          if (current.changed) emitPresence(sessionId, current.state);
        }
        return acknowledge({
          ok: true,
          sessionId,
          onlineUserIds: onlineUserIds(sessionId),
          presence: presenceSnapshot(sessionId),
        });
      } catch (error) {
        return acknowledge({ ok: false, code: error?.details?.[0]?.code || "MEMBERSHIP_REQUIRED" });
      }
    });

    socket.on("synchronized:activity", (payload = {}) => {
      const sessionId = socket.data.synchronizedSessionId || null;
      if (!sessionId || String(payload.sessionId || "") !== String(sessionId)) return;
      const current = mutatePresenceConnection({
        sessionId,
        userId: socket.data.userId,
        socketId: socket.id,
        nextActivity: payload,
      });
      if (current.changed) emitPresence(sessionId, current.state);
    });

    socket.on("disconnect", () => {
      const sessionId = socket.data.synchronizedSessionId;
      if (!sessionId) return;
      const current = mutatePresenceConnection({
        sessionId,
        userId: socket.data.userId,
        socketId: socket.id,
        remove: true,
      });
      if (current.changed) emitPresence(sessionId, current.state);
    });
  });
  return io;
}

module.exports = {
  initializeSynchronizedVisitRealtime,
  notifySynchronizedVisitChanged,
  notifySynchronizedVisitChangedForVisitSession,
  aggregateConnectionActivity,
  normalizeParticipantActivity,
  onlineUserIds,
  presenceSnapshot,
  roomName,
};
