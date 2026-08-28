const User = require("../models/user");
const VisitSessionV2 = require("../models/visitSessionV2.model");
const UserSubjectAffinity = require("../models/userSubjectAffinity.model");
const UserSubjectKnowledge = require("../models/userSubjectKnowledge.model");
const UserItemEditionAffinity = require("../models/userItemEditionAffinity.model");
const UserContentExposureV2 = require("../models/userContentExposureV2.model");
const UserNamespaceFeatureAffinity = require("../models/userNamespaceFeatureAffinity.model");
const AppError = require("../utils/AppError");
const policy = require("../config/adaptivePolicy");
const { contributorHash } = require("./contributorIdentity.service");
const { removeUserLearningV2 } = require("./learningV2.service");
const { getActiveUserOrFail } = require("./userAuthorization.service");
const { normalizeRoutingRequirements } = require("./routingPreferenceV2.service");

function unit(value, field) {
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0 || number > 1) {
    throw new AppError(`${field} deve essere tra 0 e 1`, 400, [{ field, code: "INVALID_NUMBER" }]);
  }
  return number;
}

function normalizePresentationPreference(payload = {}) {
  if (payload === null || payload?.clear === true) return null;
  return {
    depthPreference: unit(payload.depthPreference, "depthPreference"),
    languageComplexityPreference: unit(payload.languageComplexityPreference, "languageComplexityPreference"),
  };
}

function normalizeNavigationPreference(payload = {}) {
  const movementPacePreference = payload.movementPacePreference === undefined
    ? 0.5
    : unit(payload.movementPacePreference, "movementPacePreference");
  return {
    movementPacePreference,
    requirements: normalizeRoutingRequirements(payload.requirements, { field: "requirements", semanticOnly: true }),
  };
}

async function setDefaultPresentationPreference({ userId, payload }) {
  await getActiveUserOrFail(userId);
  const preference = normalizePresentationPreference(payload);
  const user = await User.findByIdAndUpdate(
    userId,
    { $set: { defaultPresentationPreference: preference } },
    { new: true, runValidators: true },
  );
  return user.defaultPresentationPreference;
}

async function setDefaultNavigationPreference({ userId, payload }) {
  await getActiveUserOrFail(userId);
  const preference = normalizeNavigationPreference(payload || {});
  const user = await User.findByIdAndUpdate(
    userId,
    { $set: { defaultNavigationPreference: preference } },
    { new: true, runValidators: true },
  );
  return user.defaultNavigationPreference;
}

async function setLearningPreferences({ userId, payload = {} }) {
  await getActiveUserOrFail(userId);
  const update = {};
  if (typeof payload.personalHistory === "boolean") {
    update["learningPreferences.personalHistory"] = payload.personalHistory;
  }
  if (typeof payload.collectiveContribution === "boolean") {
    if (payload.collectiveContribution) contributorHash(userId);
    update["learningPreferences.collectiveContribution"] = payload.collectiveContribution;
  }
  if (typeof payload.enabled === "boolean" && Object.keys(update).length === 0) {
    if (payload.enabled) contributorHash(userId);
    update["learningPreferences.personalHistory"] = payload.enabled;
    update["learningPreferences.collectiveContribution"] = payload.enabled;
  }
  if (Object.keys(update).length === 0) {
    throw new AppError("Specificare personalHistory e/o collectiveContribution", 400);
  }
  update["learningPreferences.decidedAt"] = new Date();
  const user = await User.findByIdAndUpdate(userId, { $set: update }, { new: true, runValidators: true });
  return user.learningPreferences;
}

async function getAdaptiveProfile({ userId }) {
  const [user, subjectAffinities, subjectKnowledge, editionAffinities, exposures, namespaceFeatures] = await Promise.all([
    User.findById(userId).lean(),
    UserSubjectAffinity.find({ userId }).sort({ lastObservedAt: -1 }).limit(200).lean(),
    UserSubjectKnowledge.find({ userId }).sort({ lastObservedAt: -1 }).limit(200).lean(),
    UserItemEditionAffinity.find({ userId }).sort({ lastObservedAt: -1 }).limit(200).lean(),
    UserContentExposureV2.find({ userId }).sort({ lastExposedAt: -1 }).limit(200).lean(),
    UserNamespaceFeatureAffinity.find({ userId }).sort({ lastObservedAt: -1 }).limit(200).lean(),
  ]);
  if (!user) throw new AppError("Utente non disponibile", 404);
  return {
    learningPreferences: user.learningPreferences || null,
    decisionRequired:
      user.learningPreferences?.personalHistory == null ||
      user.learningPreferences?.collectiveContribution == null,
    adaptivePolicyVersion: policy.version,
    subjectAffinities,
    subjectKnowledge,
    itemEditionAffinities: editionAffinities,
    contentExposure: exposures,
    namespaceFeatureAffinities: namespaceFeatures,
  };
}

async function resetAdaptiveProfile({ userId }) {
  await getActiveUserOrFail(userId);
  const learning = await removeUserLearningV2(userId);
  const sessions = await VisitSessionV2.updateMany(
    { userId, status: { $in: ["completed", "abandoned"] } },
    {
      $set: {
        transitionObservations: [],
        contentEntryExperiences: [],
        venueTargetObservations: [],
        interactionEvents: [],
      },
    },
  );
  return {
    reset: true,
    learning,
    sessionsCleared: sessions.modifiedCount,
    note: "Dati adattivi personali e contributi pseudonimi v2 rimossi. Gli aggregati collettivi gia derivati non vengono ricostruiti retroattivamente.",
  };
}

module.exports = {
  normalizePresentationPreference,
  normalizeNavigationPreference,
  setDefaultPresentationPreference,
  setDefaultNavigationPreference,
  setLearningPreferences,
  getAdaptiveProfile,
  resetAdaptiveProfile,
};
