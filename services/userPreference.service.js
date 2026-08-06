const User = require("../models/user");
const Visit = require("../models/visit");
const VisitRevision = require("../models/visitRevision.model");
const Item = require("../models/item.model");
const ItemRevision = require("../models/itemRevision.model");
const UserVisitPreference = require("../models/userVisitPreference.model");
const AppError = require("../utils/AppError");
const { getActiveUserOrFail } = require("./museumAuthorization.service");
const { getMuseumVocabulary } = require("./museumVocabulary.service");
const {
  assertPreferenceValue,
  findRepresentationByPolicy,
  findDefaultRepresentation,
  resolveCommunityRepresentation,
} = require("./presentationPolicy.service");

function normalizeAbstractPreference(payload = {}) {
  const preference = {
    depthPreference: Number(payload.depthPreference),
    languageComplexityPreference: Number(payload.languageComplexityPreference),
  };
  assertPreferenceValue(preference.depthPreference, "depthPreference");
  assertPreferenceValue(preference.languageComplexityPreference, "languageComplexityPreference");
  return preference;
}

async function setUserDefaultPreference({ userId, payload }) {
  const user = await getActiveUserOrFail(userId);
  if (payload === null || payload?.clear === true) {
    user.defaultPresentationPreference = null;
  } else {
    user.defaultPresentationPreference = normalizeAbstractPreference(payload);
  }
  await user.save();
  return user.defaultPresentationPreference;
}

async function getPublishedVisitOrFail(visitId) {
  const visit = await Visit.findOne({
    _id: visitId,
    lifecycleStatus: "active",
    publishedRevisionId: { $ne: null },
  });
  if (!visit) throw new AppError("Visita pubblicata non trovata", 404);
  const revision = await VisitRevision.findById(visit.publishedRevisionId);
  if (!revision) throw new AppError("Revisione pubblicata della visita non trovata", 404);
  return { visit, revision };
}

async function assertOfficialPolicyAvailable({ revision, policy }) {
  for (let index = 0; index < revision.stops.length; index += 1) {
    const item = await Item.findOne({ _id: revision.stops[index].itemId, lifecycleStatus: "active" }).lean();
    if (!item?.publishedRevisionId) {
      throw new AppError("La visita contiene un item non disponibile", 409);
    }
    const itemRevision = await ItemRevision.findById(item.publishedRevisionId).lean();
    if (!findRepresentationByPolicy(itemRevision?.representations || [], policy)) {
      throw new AppError("La preferenza non e disponibile in tutte le tappe", 400, [
        {
          field: `stops[${index}]`,
          code: "PREFERENCE_NOT_AVAILABLE",
          message: "La combinazione scelta non e disponibile per questa tappa",
          context: { itemId: item._id, ...policy },
        },
      ]);
    }
  }
}

async function setVisitPreference({ userId, visitId, payload }) {
  await getActiveUserOrFail(userId);
  const { visit, revision } = await getPublishedVisitOrFail(visitId);
  const mode = payload?.mode === "custom" ? "custom" : "default";
  const data = {
    userId,
    visitId,
    mode,
    durationKey: null,
    languageLevelKey: null,
    depthPreference: null,
    languageComplexityPreference: null,
  };

  if (mode === "custom" && visit.kind === "official") {
    const vocabulary = await getMuseumVocabulary(visit.ownerMuseumId);
    const policy = {
      durationKey: typeof payload.durationKey === "string" ? payload.durationKey.trim().toLowerCase() : "",
      languageLevelKey: typeof payload.languageLevelKey === "string" ? payload.languageLevelKey.trim().toLowerCase() : "",
    };
    if (!vocabulary.durationTypes.some((entry) => entry.key === policy.durationKey)) {
      throw new AppError("durationKey non valida", 400);
    }
    if (!vocabulary.languageLevels.some((entry) => entry.key === policy.languageLevelKey)) {
      throw new AppError("languageLevelKey non valida", 400);
    }
    await assertOfficialPolicyAvailable({ revision, policy });
    Object.assign(data, policy);
  }

  if (mode === "custom" && visit.kind === "community") {
    Object.assign(data, normalizeAbstractPreference(payload));
  }

  return UserVisitPreference.findOneAndUpdate(
    { userId, visitId },
    { $set: data },
    { upsert: true, new: true, runValidators: true },
  );
}

async function getEffectivePreference({ userId, visit }) {
  const [user, visitPreference] = await Promise.all([
    User.findById(userId).lean(),
    UserVisitPreference.findOne({ userId, visitId: visit._id }).lean(),
  ]);
  if (visit.kind === "official") {
    return visitPreference?.mode === "custom"
      ? {
          mode: "custom",
          durationKey: visitPreference.durationKey,
          languageLevelKey: visitPreference.languageLevelKey,
        }
      : { mode: "default" };
  }
  if (visitPreference?.mode === "custom") {
    return {
      mode: "custom",
      depthPreference: visitPreference.depthPreference,
      languageComplexityPreference: visitPreference.languageComplexityPreference,
    };
  }
  if (user?.defaultPresentationPreference) {
    return { mode: "user_default", ...user.defaultPresentationPreference };
  }
  return { mode: "item_default" };
}

async function getStoredVisitPreference({ userId, visitId }) {
  await getActiveUserOrFail(userId);
  await getPublishedVisitOrFail(visitId);
  return UserVisitPreference.findOne({ userId, visitId }).lean();
}

async function getVisitPreferenceOptions({ userId, visitId }) {
  await getActiveUserOrFail(userId);
  const { visit, revision } = await getPublishedVisitOrFail(visitId);
  if (visit.kind === "community") {
    return {
      kind: "community",
      dimensions: {
        depthPreference: { min: 0, max: 1 },
        languageComplexityPreference: { min: 0, max: 1 },
      },
      fallback: "item_default",
    };
  }

  const vocabulary = await getMuseumVocabulary(visit.ownerMuseumId);
  let commonPairs = null;
  for (const stop of revision.stops) {
    const item = await Item.findOne({ _id: stop.itemId, lifecycleStatus: "active" }).lean();
    if (!item?.publishedRevisionId) throw new AppError("La visita contiene un item non disponibile", 409);
    const itemRevision = await ItemRevision.findById(item.publishedRevisionId).lean();
    const pairs = new Set(
      (itemRevision?.representations || []).map(
        (entry) => `${entry.durationKey}::${entry.languageLevelKey}`,
      ),
    );
    commonPairs = commonPairs === null
      ? pairs
      : new Set([...commonPairs].filter((pair) => pairs.has(pair)));
  }

  const combinations = [...(commonPairs || new Set())].map((pair) => {
    const [durationKey, languageLevelKey] = pair.split("::");
    return { durationKey, languageLevelKey };
  });
  return {
    kind: "official",
    defaultPresentationPolicy: revision.defaultPresentationPolicy,
    durationTypes: vocabulary.durationTypes,
    languageLevels: vocabulary.languageLevels,
    combinations,
  };
}

async function buildPresentationPlan({ userId, visitId }) {
  await getActiveUserOrFail(userId);
  const { visit, revision } = await getPublishedVisitOrFail(visitId);
  const effectivePreference = await getEffectivePreference({ userId, visit });
  const stops = [];
  let estimatedContentSeconds = 0;

  for (let index = 0; index < revision.stops.length; index += 1) {
    const stop = revision.stops[index];
    const item = await Item.findOne({ _id: stop.itemId, lifecycleStatus: "active" }).lean();
    if (!item?.publishedRevisionId) throw new AppError("Una tappa della visita non e disponibile", 409);
    const itemRevision = await ItemRevision.findById(item.publishedRevisionId).lean();
    if (!itemRevision) throw new AppError("Revisione pubblicata dell'item non trovata", 409);
    const vocabulary = await getMuseumVocabulary(item.museumId);

    let representation = null;
    if (visit.kind === "official") {
      const policy = effectivePreference.mode === "custom"
        ? effectivePreference
        : revision.defaultPresentationPolicy;
      representation = findRepresentationByPolicy(itemRevision.representations || [], policy);
    } else if (["custom", "user_default"].includes(effectivePreference.mode)) {
      representation = resolveCommunityRepresentation({
        representations: itemRevision.representations || [],
        durationTypes: vocabulary.durationTypes,
        languageLevels: vocabulary.languageLevels,
        preference: effectivePreference,
      });
    } else {
      representation = findDefaultRepresentation(itemRevision.representations || []);
    }

    if (!representation) throw new AppError("Impossibile risolvere una representation per una tappa", 409);
    const duration = vocabulary.durationTypes.find((entry) => entry.key === representation.durationKey);
    estimatedContentSeconds += duration?.targetSeconds || 0;
    stops.push({
      position: index,
      itemId: item._id,
      itemRevisionId: itemRevision._id,
      museumId: item.museumId,
      representation,
      targetSeconds: duration?.targetSeconds || null,
      optional: stop.optional === true,
    });
  }

  return {
    visitId: visit._id,
    visitRevisionId: revision._id,
    kind: visit.kind,
    effectivePreference,
    estimatedContentSeconds,
    stops,
  };
}

module.exports = {
  normalizeAbstractPreference,
  setUserDefaultPreference,
  setVisitPreference,
  getStoredVisitPreference,
  getVisitPreferenceOptions,
  getEffectivePreference,
  buildPresentationPlan,
};
