const User = require("../models/user");
const Visit = require("../models/visit");
const VisitRevision = require("../models/visitRevision.model");
const Item = require("../models/item.model");
const ItemRevision = require("../models/itemRevision.model");
const UserVisitPreference = require("../models/userVisitPreference.model");
const AppError = require("../utils/AppError");
const { getActiveUserOrFail } = require("./museumAuthorization.service");
const { getMuseumVocabulary } = require("./museumVocabulary.service");
const { assertPreferenceValue, findRepresentationByPolicy, findDefaultRepresentation, resolveCommunityRepresentation } = require("./presentationPolicy.service");
const { listRepresentationCandidates } = require("./presentationModel.service");

function normalizeAbstractPreference(payload = {}) {
  const preference = { depthPreference: Number(payload.depthPreference), languageComplexityPreference: Number(payload.languageComplexityPreference) };
  assertPreferenceValue(preference.depthPreference, "depthPreference");
  assertPreferenceValue(preference.languageComplexityPreference, "languageComplexityPreference");
  return preference;
}
async function setUserDefaultPreference({ userId, payload }) {
  const user = await getActiveUserOrFail(userId);
  user.defaultPresentationPreference = payload === null || payload?.clear === true ? null : normalizeAbstractPreference(payload);
  await user.save();
  return user.defaultPresentationPreference;
}
async function getPublishedVisitOrFail(visitId) {
  const visit = await Visit.findOne({ _id: visitId, lifecycleStatus: "active", publishedRevisionId: { $ne: null } });
  if (!visit) throw new AppError("Visita pubblicata non trovata", 404);
  const revision = await VisitRevision.findById(visit.publishedRevisionId);
  if (!revision) throw new AppError("Revisione pubblicata della visita non trovata", 404);
  return { visit, revision };
}
async function assertOfficialPolicyAvailable({ revision, policy }) {
  for (let index = 0; index < revision.contentEntries.length; index += 1) {
    const entry = revision.contentEntries[index];
    const item = await Item.findOne({ _id: entry.itemId, lifecycleStatus: "active" }).lean();
    if (!item?.publishedRevisionId) throw new AppError("La visita contiene un item non disponibile", 409);
    const itemRevision = await ItemRevision.findById(item.publishedRevisionId).lean();
    if (!findRepresentationByPolicy(itemRevision, policy)) throw new AppError("La preferenza non e disponibile in tutti i contenuti", 400, [{ field: `contentEntries[${index}]`, code: "PREFERENCE_NOT_AVAILABLE", message: "La combinazione scelta non e disponibile per questo contenuto", context: { itemId: item._id, ...policy } }]);
  }
}
async function setVisitPreference({ userId, visitId, payload }) {
  await getActiveUserOrFail(userId);
  const { visit, revision } = await getPublishedVisitOrFail(visitId);
  const mode = payload?.mode === "custom" ? "custom" : "default";
  const data = { userId, visitId, mode, durationKey: null, languageLevelKey: null, depthPreference: null, languageComplexityPreference: null };
  if (mode === "custom" && visit.kind === "official") {
    const vocabulary = await getMuseumVocabulary(visit.ownerMuseumId);
    const policy = { durationKey: String(payload.durationKey || "").trim().toLowerCase(), languageLevelKey: String(payload.languageLevelKey || "").trim().toLowerCase() };
    if (!vocabulary.durationTypes.some((entry) => entry.key === policy.durationKey)) throw new AppError("durationKey non valida", 400);
    if (!vocabulary.languageLevels.some((entry) => entry.key === policy.languageLevelKey)) throw new AppError("languageLevelKey non valida", 400);
    await assertOfficialPolicyAvailable({ revision, policy });
    Object.assign(data, policy);
  }
  if (mode === "custom" && visit.kind === "community") Object.assign(data, normalizeAbstractPreference(payload));
  return UserVisitPreference.findOneAndUpdate({ userId, visitId }, { $set: data }, { upsert: true, new: true, runValidators: true });
}
async function getEffectivePreference({ userId, visit }) {
  const [user, visitPreference] = await Promise.all([User.findById(userId).lean(), UserVisitPreference.findOne({ userId, visitId: visit._id }).lean()]);
  if (visit.kind === "official") return visitPreference?.mode === "custom" ? { mode: "custom", durationKey: visitPreference.durationKey, languageLevelKey: visitPreference.languageLevelKey } : { mode: "default" };
  if (visitPreference?.mode === "custom") return { mode: "custom", depthPreference: visitPreference.depthPreference, languageComplexityPreference: visitPreference.languageComplexityPreference };
  if (user?.defaultPresentationPreference) return { mode: "user_default", ...user.defaultPresentationPreference };
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
  if (visit.kind === "community") return { kind: "community", dimensions: { depthPreference: { min: 0, max: 1 }, languageComplexityPreference: { min: 0, max: 1 } }, fallback: "item_default" };
  const vocabulary = await getMuseumVocabulary(visit.ownerMuseumId);
  let commonPairs = null;
  for (const entry of revision.contentEntries) {
    const item = await Item.findOne({ _id: entry.itemId, lifecycleStatus: "active" }).lean();
    if (!item?.publishedRevisionId) throw new AppError("La visita contiene un item non disponibile", 409);
    const itemRevision = await ItemRevision.findById(item.publishedRevisionId).lean();
    const pairs = new Set(listRepresentationCandidates(itemRevision).map((candidate) => `${candidate.representation.durationKey}::${candidate.representation.languageLevelKey}`));
    commonPairs = commonPairs === null ? pairs : new Set([...commonPairs].filter((pair) => pairs.has(pair)));
  }
  return { kind: "official", defaultPresentationPolicy: revision.defaultPresentationPolicy, durationTypes: vocabulary.durationTypes, languageLevels: vocabulary.languageLevels, combinations: [...(commonPairs || new Set())].map((pair) => { const [durationKey, languageLevelKey] = pair.split("::"); return { durationKey, languageLevelKey }; }) };
}
async function buildPresentationPlan({ userId, visitId }) {
  await getActiveUserOrFail(userId);
  const { visit, revision } = await getPublishedVisitOrFail(visitId);
  const effectivePreference = await getEffectivePreference({ userId, visit });
  const contentEntries = [];
  let estimatedContentSeconds = 0;
  for (let index = 0; index < revision.contentEntries.length; index += 1) {
    const sourceEntry = revision.contentEntries[index];
    const item = await Item.findOne({ _id: sourceEntry.itemId, lifecycleStatus: "active" }).lean();
    if (!item?.publishedRevisionId) throw new AppError("Un contenuto della visita non e disponibile", 409);
    const itemRevision = await ItemRevision.findById(item.publishedRevisionId).lean();
    if (!itemRevision) throw new AppError("Revisione pubblicata dell'item non trovata", 409);
    const vocabulary = await getMuseumVocabulary(item.museumId);
    let representation = null;
    if (visit.kind === "official") {
      const policy = effectivePreference.mode === "custom" ? effectivePreference : revision.defaultPresentationPolicy;
      representation = findRepresentationByPolicy(itemRevision, policy) || findDefaultRepresentation(itemRevision);
    } else if (["custom", "user_default"].includes(effectivePreference.mode)) {
      representation = resolveCommunityRepresentation({ source: itemRevision, durationTypes: vocabulary.durationTypes, languageLevels: vocabulary.languageLevels, preference: effectivePreference });
    } else representation = findDefaultRepresentation(itemRevision);
    if (!representation) throw new AppError("Impossibile risolvere una representation per un contenuto", 409);
    const duration = vocabulary.durationTypes.find((entry) => entry.key === representation.durationKey);
    const targetSeconds = duration?.targetSeconds || 0;
    estimatedContentSeconds += targetSeconds;
    contentEntries.push({
      position: index,
      sourceContentEntryId: sourceEntry._id,
      itemId: item._id,
      itemRevisionId: itemRevision._id,
      museumId: item.museumId,
      role: sourceEntry.role || "recommended",
      spatialMode: sourceEntry.spatialMode,
      variantKey: representation.variantKey || null,
      representation,
      targetSeconds,
    });
  }
  return { visitId: visit._id, visitRevisionId: revision._id, kind: visit.kind, effectivePreference, estimatedContentSeconds, contentEntries };
}

module.exports = { normalizeAbstractPreference, setUserDefaultPreference, setVisitPreference, getStoredVisitPreference, getVisitPreferenceOptions, getEffectivePreference, buildPresentationPlan };
