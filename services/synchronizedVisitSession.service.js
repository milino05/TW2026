const User = require("../models/user");
const VisitRevisionV2 = require("../models/visitRevisionV2.model");
const VisitSessionV2 = require("../models/visitSessionV2.model");
const SessionPlanRevisionV2 = require("../models/sessionPlanRevisionV2.model");
const SynchronizedVisitSession = require("../models/synchronizedVisitSession.model");
const SynchronizedVisitMembership = require("../models/synchronizedVisitMembership.model");
const AppError = require("../utils/AppError");
const {
  createInitialSynchronizedSessionPlan,
  buildPersonalPresentationOverrides,
} = require("./sessionPlanV2.service");

const JOINABLE_STATUSES = ["lobby", "active", "quiz"];

function normalizeJoinAlias(value) {
  return String(value || "").trim().replace(/\s+/g, " ");
}

function joinLookupKey(value) {
  return normalizeJoinAlias(value).toLocaleLowerCase("it-IT");
}

function aliasCandidate(baseAlias, suffix) {
  const suffixText = suffix > 1 ? ` ${suffix}` : "";
  return `${baseAlias.slice(0, Math.max(1, 80 - suffixText.length)).trim()}${suffixText}`;
}

function duplicateKey(error) { return Number(error?.code) === 11000; }

async function activateReadableAlias(group, preferredAlias) {
  const baseAlias = normalizeJoinAlias(preferredAlias) || "Visita insieme";
  for (let suffix = 1; suffix <= 999; suffix += 1) {
    const candidate = aliasCandidate(baseAlias, suffix);
    const key = joinLookupKey(candidate);
    const occupied = await SynchronizedVisitSession.exists({ _id: { $ne: group._id }, joinLookupKey: key });
    if (occupied) continue;
    try {
      const updated = await SynchronizedVisitSession.findOneAndUpdate(
        { _id: group._id, joinLookupKey: null, status: "lobby" },
        { $set: { joinAlias: candidate, joinLookupKey: key } },
        { new: true, runValidators: true },
      );
      if (!updated) throw new AppError("Sessione sincronizzata non più attivabile", 409);
      return updated;
    } catch (error) {
      if (!duplicateKey(error)) throw error;
    }
  }
  throw new AppError("Non è stato possibile assegnare un alias leggibile", 409, [{ code: "SYNCHRONIZED_ALIAS_UNAVAILABLE" }]);
}

async function createPersonalVisitSession({
  user,
  group,
  plan,
  presentationPreference = null,
}) {
  const personalPreference = presentationPreference || user.defaultPresentationPreference || null;
  const presentationOverrides = await buildPersonalPresentationOverrides({ plan, presentationPreference: personalPreference });
  return VisitSessionV2.create({
    userId: user._id,
    sourceType: "visit",
    visitId: group.visitId,
    visitRevisionId: group.visitRevisionId,
    synchronizedSessionId: group._id,
    currentPlanRevisionId: null,
    currentEntryIndex: null,
    venuePins: [],
    sessionMovementSpeedMps: null,
    adaptivePolicyVersion: group.adaptivePolicyVersion,
    presentationOverrides,
  });
}

async function createSynchronizedVisitRuntime({
  hostUserId,
  visitId,
  visitRevisionId,
  preferredAlias,
  plan,
  venuePins,
  navigationSnapshot,
  sessionMovementSpeedMps,
  adaptivePolicyVersion,
  hostPresentationPreference = null,
}) {
  const host = await User.findOne({ _id: hostUserId, status: "active" });
  if (!host) throw new AppError("Utente host non disponibile", 404);
  let group = null;
  let planRevision = null;
  let hostVisitSession = null;
  try {
    group = await SynchronizedVisitSession.create({
      visitId,
      visitRevisionId,
      hostUserId,
      joinAlias: normalizeJoinAlias(preferredAlias) || "Visita insieme",
      joinLookupKey: null,
      status: "lobby",
      currentEntryIndex: 0,
      venuePins: venuePins || [],
      navigationSnapshot: navigationSnapshot || {},
      sessionMovementSpeedMps,
      adaptivePolicyVersion,
    });
    planRevision = await createInitialSynchronizedSessionPlan({ synchronizedSession: group, plan });
    hostVisitSession = await createPersonalVisitSession({
      user: host,
      group,
      plan: planRevision,
      presentationPreference: hostPresentationPreference,
    });
    await SynchronizedVisitMembership.create({
      synchronizedSessionId: group._id,
      userId: host._id,
      role: "host",
      visitSessionId: hostVisitSession._id,
      status: "active",
    });
    group = await activateReadableAlias(group, preferredAlias);
    return { synchronizedSession: group, hostVisitSession, plan: planRevision };
  } catch (error) {
    if (group?._id) {
      await SynchronizedVisitMembership.deleteMany({ synchronizedSessionId: group._id }).catch(() => {});
      await VisitSessionV2.deleteMany({ synchronizedSessionId: group._id }).catch(() => {});
      await SessionPlanRevisionV2.deleteMany({ planOwnerType: "synchronized_visit_session", planOwnerId: group._id }).catch(() => {});
      await SynchronizedVisitSession.deleteOne({ _id: group._id }).catch(() => {});
    }
    throw error;
  }
}

async function loadMembershipRuntime({ synchronizedSessionId, userId, allowFinished = true }) {
  const [group, membership] = await Promise.all([
    SynchronizedVisitSession.findById(synchronizedSessionId),
    SynchronizedVisitMembership.findOne({ synchronizedSessionId, userId }),
  ]);
  if (!group || !membership || membership.status === "removed") {
    throw new AppError("Partecipazione sincronizzata non disponibile", 404, [{ code: "SYNCHRONIZED_MEMBERSHIP_REQUIRED" }]);
  }
  if (!allowFinished && !JOINABLE_STATUSES.includes(group.status)) {
    throw new AppError("La visita sincronizzata è terminata", 409, [{ code: "SYNCHRONIZED_SESSION_FINISHED" }]);
  }
  const visitSession = await VisitSessionV2.findOne({
    _id: membership.visitSessionId,
    synchronizedSessionId: group._id,
    userId,
  });
  if (!visitSession) throw new AppError("Esperienza personale della visita non disponibile", 409);
  return { group, membership, visitSession };
}

async function joinSynchronizedVisitSession({ userId, alias }) {
  const normalizedAlias = normalizeJoinAlias(alias);
  if (!normalizedAlias) throw new AppError("Inserisci l'alias della visita", 400, [{ field: "joinAlias", code: "REQUIRED" }]);
  const [user, group] = await Promise.all([
    User.findOne({ _id: userId, status: "active" }),
    SynchronizedVisitSession.findOne({ joinLookupKey: joinLookupKey(normalizedAlias), status: { $in: JOINABLE_STATUSES } }),
  ]);
  if (!user) throw new AppError("Utente non disponibile", 404);
  if (!group) throw new AppError("Nessuna visita attiva con questo alias", 404, [{ code: "SYNCHRONIZED_ALIAS_NOT_FOUND" }]);

  const existing = await SynchronizedVisitMembership.findOne({ synchronizedSessionId: group._id, userId });
  if (existing) {
    if (existing.status !== "active") throw new AppError("Non puoi rientrare in questa visita", 403, [{ code: "SYNCHRONIZED_MEMBERSHIP_INACTIVE" }]);
    const visitSession = await VisitSessionV2.findOne({ _id: existing.visitSessionId, userId, synchronizedSessionId: group._id });
    if (!visitSession) throw new AppError("Esperienza personale della visita non disponibile", 409);
    return { synchronizedSession: group, membership: existing, visitSession, rejoined: true };
  }

  const plan = await SessionPlanRevisionV2.findOne({
    _id: group.currentPlanRevisionId,
    planOwnerType: "synchronized_visit_session",
    planOwnerId: group._id,
  });
  if (!plan) throw new AppError("Piano condiviso non disponibile", 409);

  let visitSession = null;
  try {
    visitSession = await createPersonalVisitSession({ user, group, plan });
    const membership = await SynchronizedVisitMembership.create({
      synchronizedSessionId: group._id,
      userId,
      role: "participant",
      visitSessionId: visitSession._id,
      status: "active",
    });
    return { synchronizedSession: group, membership, visitSession, rejoined: false };
  } catch (error) {
    if (visitSession?._id) await VisitSessionV2.deleteOne({ _id: visitSession._id }).catch(() => {});
    if (!duplicateKey(error)) throw error;
    const current = await SynchronizedVisitMembership.findOne({ synchronizedSessionId: group._id, userId });
    if (!current || current.status !== "active") throw error;
    const currentVisitSession = await VisitSessionV2.findOne({ _id: current.visitSessionId, userId, synchronizedSessionId: group._id });
    if (!currentVisitSession) throw error;
    return { synchronizedSession: group, membership: current, visitSession: currentVisitSession, rejoined: true };
  }
}

async function projectSynchronizedVisitSession({ synchronizedSessionId, userId }) {
  const { group, membership, visitSession } = await loadMembershipRuntime({ synchronizedSessionId, userId });
  const [revision, sharedPlan] = await Promise.all([
    VisitRevisionV2.findById(group.visitRevisionId).select("title quiz.questions").lean(),
    SessionPlanRevisionV2.findOne({
      _id: group.currentPlanRevisionId,
      planOwnerType: "synchronized_visit_session",
      planOwnerId: group._id,
    }).select("contentEntries._id").lean(),
  ]);
  if (!revision) throw new AppError("Snapshot della visita non disponibile", 409);
  if (!sharedPlan) throw new AppError("Piano condiviso non disponibile", 409);
  let participants = null;
  if (membership.role === "host") {
    const memberships = await SynchronizedVisitMembership.find({ synchronizedSessionId: group._id, status: { $ne: "removed" } }).sort({ joinedAt: 1 }).lean();
    const [users, personalSessions] = await Promise.all([
      User.find({ _id: { $in: memberships.map((entry) => entry.userId) } }).select("username").lean(),
      VisitSessionV2.find({ _id: { $in: memberships.map((entry) => entry.visitSessionId) } })
        .select("semanticPresentation contentEntryExperiences interactionEvents presentationOverrides")
        .lean(),
    ]);
    const userById = new Map(users.map((entry) => [String(entry._id), entry]));
    const sessionById = new Map(personalSessions.map((entry) => [String(entry._id), entry]));
    const currentContentEntryId = sharedPlan.contentEntries?.[group.currentEntryIndex]?._id || null;
    participants = memberships.map((entry) => ({
      userId: entry.userId,
      username: userById.get(String(entry.userId))?.username || "Partecipante",
      role: entry.role,
      status: entry.status,
      joinedAt: entry.joinedAt,
      visitSessionId: entry.visitSessionId,
      experience: (() => {
        const personal = sessionById.get(String(entry.visitSessionId));
        const experiences = currentContentEntryId
          ? (personal?.contentEntryExperiences || []).filter((value) => String(value.contentEntryId) === String(currentContentEntryId))
          : [];
        const latestExperience = experiences.at(-1) || null;
        const currentEvents = currentContentEntryId
          ? (personal?.interactionEvents || []).filter((value) => String(value.context?.contentEntryId || "") === String(currentContentEntryId))
          : [];
        const semanticActive = Boolean(currentContentEntryId)
          && String(personal?.semanticPresentation?.sourceContentEntryId || "") === String(currentContentEntryId);
        const completionRatio = latestExperience?.completionRatio ?? 0;
        const lastActivityAt = [latestExperience?.createdAt, ...currentEvents.map((value) => value.at)].filter(Boolean).sort((a, b) => new Date(b) - new Date(a))[0] || null;
        return {
          status: completionRatio >= 0.95 ? "completed" : (latestExperience || currentEvents.length || semanticActive) ? "in_progress" : "not_started",
          completionRatio,
          personalAdaptationActive: semanticActive || (personal?.presentationOverrides || []).some((value) => String(value.contentEntryId) === String(currentContentEntryId)),
          lastActivityAt,
        };
      })(),
    }));
  }
  return {
    synchronizedSession: {
      id: group._id,
      visitId: group.visitId,
      visitRevisionId: group.visitRevisionId,
      title: revision.title,
      joinAlias: group.joinAlias,
      status: group.status,
      currentEntryIndex: group.currentEntryIndex,
      contentEntryCount: sharedPlan.contentEntries?.length || 0,
      runtimeVersion: group.runtimeVersion,
      playback: {
        state: group.playback?.state || "idle",
        contentEntryId: group.playback?.contentEntryId || null,
        commandVersion: group.playback?.commandVersion || 0,
        changedAt: group.playback?.changedAt || null,
      },
      participantCount: await SynchronizedVisitMembership.countDocuments({ synchronizedSessionId: group._id, role: "participant", status: "active" }),
      quizQuestionCount: revision.quiz?.questions?.length || 0,
    },
    membership: {
      id: membership._id,
      role: membership.role,
      status: membership.status,
      visitSessionId: visitSession._id,
      joinedAt: membership.joinedAt,
    },
    participants,
  };
}

function resetSynchronizedPlayback(group, { changedBy = null } = {}) {
  const previousVersion = Number(group.playback?.commandVersion) || 0;
  group.playback = {
    state: "idle",
    contentEntryId: null,
    commandVersion: previousVersion + 1,
    changedAt: new Date(),
    changedBy,
  };
}

async function controlSynchronizedPlayback({ synchronizedSessionId, userId, command }) {
  const group = await requireHostRuntime({ synchronizedSessionId, userId, status: "active" });
  const plan = await SessionPlanRevisionV2.findOne({
    _id: group.currentPlanRevisionId,
    planOwnerType: "synchronized_visit_session",
    planOwnerId: group._id,
  }).select("contentEntries._id").lean();
  const contentEntry = plan?.contentEntries?.[group.currentEntryIndex] || null;
  if (!contentEntry) throw new AppError("Contenuto corrente non disponibile", 409, [{ code: "SYNCHRONIZED_CONTENT_UNAVAILABLE" }]);

  const currentState = group.playback?.state || "idle";
  const transitions = {
    play: { from: ["idle"], to: "playing" },
    pause: { from: ["playing"], to: "paused" },
    resume: { from: ["paused"], to: "playing" },
    stop: { from: ["playing", "paused"], to: "idle" },
  };
  const transition = transitions[command];
  if (!transition || !transition.from.includes(currentState)) {
    throw new AppError("Comando di ascolto non disponibile", 409, [{ code: "SYNCHRONIZED_PLAYBACK_STATE_CONFLICT" }]);
  }
  const previousVersion = Number(group.playback?.commandVersion) || 0;
  group.playback = {
    state: transition.to,
    contentEntryId: transition.to === "idle" ? null : contentEntry._id,
    commandVersion: previousVersion + 1,
    changedAt: new Date(),
    changedBy: userId,
  };
  await group.save();
  return group;
}

async function requireHostRuntime({ synchronizedSessionId, userId, status }) {
  const { group, membership } = await loadMembershipRuntime({ synchronizedSessionId, userId, allowFinished: true });
  if (membership.role !== "host") throw new AppError("Operazione riservata alla guida", 403, [{ code: "SYNCHRONIZED_HOST_REQUIRED" }]);
  if (status && group.status !== status) throw new AppError("Operazione non disponibile nello stato corrente", 409, [{ code: "SYNCHRONIZED_STATUS_CONFLICT", context: { currentStatus: group.status } }]);
  return group;
}

async function startSynchronizedVisit({ synchronizedSessionId, userId }) {
  const group = await requireHostRuntime({ synchronizedSessionId, userId, status: "lobby" });
  group.status = "active";
  group.startedAt = new Date();
  await group.save();
  return group;
}

async function startSynchronizedQuiz({ synchronizedSessionId, userId }) {
  const group = await requireHostRuntime({ synchronizedSessionId, userId, status: "active" });
  const revision = await VisitRevisionV2.findById(group.visitRevisionId).select("quiz.questions").lean();
  if (!revision?.quiz?.questions?.length) throw new AppError("Questa visita non contiene un quiz", 409, [{ code: "SYNCHRONIZED_QUIZ_UNAVAILABLE" }]);
  group.status = "quiz";
  resetSynchronizedPlayback(group, { changedBy: userId });
  group.quizStartedAt = new Date();
  await group.save();
  return group;
}

async function completeSynchronizedVisit({ synchronizedSessionId, userId }) {
  const group = await requireHostRuntime({ synchronizedSessionId, userId, status: "quiz" });
  const completedAt = new Date();
  group.status = "completed";
  group.joinLookupKey = null;
  group.completedAt = completedAt;
  resetSynchronizedPlayback(group, { changedBy: userId });
  await group.save();
  const memberships = await SynchronizedVisitMembership.find({ synchronizedSessionId: group._id, status: "active" }).select("_id visitSessionId").lean();
  await Promise.all([
    SynchronizedVisitMembership.updateMany(
      { synchronizedSessionId: group._id, status: "active" },
      { $set: { status: "completed", completedAt } },
    ),
    VisitSessionV2.updateMany(
      { _id: { $in: memberships.map((entry) => entry.visitSessionId) }, synchronizedSessionId: group._id },
      { $set: { status: "completed", completedAt } },
    ),
  ]);
  return group;
}

async function cancelSynchronizedVisit({ synchronizedSessionId, userId }) {
  const group = await requireHostRuntime({ synchronizedSessionId, userId });
  if (!JOINABLE_STATUSES.includes(group.status)) {
    throw new AppError("La sessione sincronizzata è già terminata", 409, [{ code: "SYNCHRONIZED_SESSION_FINISHED" }]);
  }
  const cancelledAt = new Date();
  group.status = "cancelled";
  group.joinLookupKey = null;
  group.cancelledAt = cancelledAt;
  resetSynchronizedPlayback(group, { changedBy: userId });
  await group.save();
  const memberships = await SynchronizedVisitMembership.find({ synchronizedSessionId: group._id, status: "active" }).select("_id visitSessionId").lean();
  await Promise.all([
    SynchronizedVisitMembership.updateMany(
      { synchronizedSessionId: group._id, status: "active" },
      { $set: { status: "completed", completedAt: cancelledAt } },
    ),
    VisitSessionV2.updateMany(
      { _id: { $in: memberships.map((entry) => entry.visitSessionId) }, synchronizedSessionId: group._id },
      { $set: { status: "abandoned", completedAt: cancelledAt } },
    ),
  ]);
  return group;
}

module.exports = {
  JOINABLE_STATUSES,
  normalizeJoinAlias,
  joinLookupKey,
  createSynchronizedVisitRuntime,
  joinSynchronizedVisitSession,
  loadMembershipRuntime,
  projectSynchronizedVisitSession,
  controlSynchronizedPlayback,
  resetSynchronizedPlayback,
  startSynchronizedVisit,
  startSynchronizedQuiz,
  completeSynchronizedVisit,
  cancelSynchronizedVisit,
};
