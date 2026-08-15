const Visit = require("../models/visit");
const VisitRevision = require("../models/visitRevision.model");
const User = require("../models/user");
const UserVisitPreference = require("../models/userVisitPreference.model");
const VisitSession = require("../models/visitSession.model");
const SessionPlanRevision = require("../models/sessionPlanRevision.model");
const VisitTimingProfile = require("../models/visitTimingProfile.model");
const AppError = require("../utils/AppError");
const { getActiveUserOrFail, assertMuseumRole, hasMuseumRole } = require("./museumAuthorization.service");
const { normalizeVisitPayload, validateVisitDraftPayload } = require("./validation/visit.validation");
const { markRevisionEdited } = require("./revisionWorkflow.service");

const REVISION_FIELDS = ["title", "description", "defaultPresentationPolicy", "contentEntries", "logistics"];
function hasOwn(object, key) { return Object.prototype.hasOwnProperty.call(object, key); }
function rejectManagedFields(payload = {}) {
  const forbidden = ["status", "integrity", "review", "publication", "version", "visitId", "museumIds", "baselineTiming"];
  const errors = forbidden.filter((field) => hasOwn(payload, field)).map((field) => ({ field, code: "FORBIDDEN_FIELD", message: `${field} e gestito dal backend` }));
  if (errors.length) throw new AppError("Payload non valido", 400, errors);
}
function revisionSnapshot(revision) {
  const source = revision.toObject ? revision.toObject() : revision;
  return REVISION_FIELDS.reduce((snapshot, field) => { snapshot[field] = source[field]; return snapshot; }, {});
}
function mergeRevisionPayload(revision, rawPayload, normalizedPayload) {
  const result = revisionSnapshot(revision);
  for (const field of REVISION_FIELDS) if (hasOwn(rawPayload, field)) result[field] = normalizedPayload[field];
  return result;
}
async function findVisitOrFail(visitId, { includeTrashed = false } = {}) {
  const query = { _id: visitId };
  if (!includeTrashed) query.lifecycleStatus = "active";
  const visit = await Visit.findOne(query);
  if (!visit) throw new AppError("Visita non trovata", 404);
  return visit;
}
async function assertVisitEditor({ visit, actorUserId, managerRequired = false }) {
  if (visit.kind === "community") {
    const user = await getActiveUserOrFail(actorUserId);
    if (String(visit.createdBy) !== String(user._id)) throw new AppError("Solo l'autore puo gestire questa visita community", 403);
    return user;
  }
  return assertMuseumRole({ userId: actorUserId, museumId: visit.ownerMuseumId, minimumRole: managerRequired ? "manager" : "operator" });
}
async function nextVersion(visitId) {
  const latest = await VisitRevision.findOne({ visitId }).sort({ version: -1 }).select("version").lean();
  return (latest?.version || 0) + 1;
}

async function createWorkingRevisionFromPublished(visit, actorUserId) {
  if (!visit.publishedRevisionId) throw new AppError("Nessuna revisione pubblicata da clonare", 409);
  const published = await VisitRevision.findById(visit.publishedRevisionId);
  if (!published) throw new AppError("Revisione pubblicata non trovata", 409);
  const revision = new VisitRevision({
    visitId: visit._id,
    version: await nextVersion(visit._id),
    basedOnRevisionId: published._id,
    ...revisionSnapshot(published),
    museumIds: published.museumIds,
    baselineTiming: {},
    status: "draft",
    integrity: { status: "needs_review", issues: [] },
    createdBy: actorUserId,
    updatedBy: actorUserId,
  });
  await revision.save();
  try {
    const pointer = await Visit.updateOne(
      { _id: visit._id, workingRevisionId: null, publishedRevisionId: visit.publishedRevisionId, lifecycleStatus: "active" },
      { $set: { workingRevisionId: revision._id } },
    );
    if (pointer.modifiedCount !== 1) throw new AppError("La visita e cambiata durante la creazione della revisione di lavoro", 409);
    visit.workingRevisionId = revision._id;
    return revision;
  } catch (error) {
    await revision.deleteOne().catch(() => {});
    throw error;
  }
}
async function getWorkingRevision(visit, actorUserId, { createFromPublished = true } = {}) {
  if (visit.workingRevisionId) {
    const revision = await VisitRevision.findById(visit.workingRevisionId);
    if (!revision) throw new AppError("Revisione di lavoro non trovata", 409);
    return revision;
  }
  if (createFromPublished && visit.publishedRevisionId) return createWorkingRevisionFromPublished(visit, actorUserId);
  throw new AppError("La visita non ha una revisione di lavoro", 409);
}

async function createVisit({ payload, actorUserId }) {
  const actor = await getActiveUserOrFail(actorUserId);
  rejectManagedFields(payload);
  const normalized = normalizeVisitPayload(payload);
  const errors = validateVisitDraftPayload({ payload: normalized, kind: normalized.kind, mode: "create" });
  if (errors.length) throw new AppError("Payload non valido", 400, errors);
  if (normalized.kind === "official") await assertMuseumRole({ userId: actor._id, museumId: normalized.ownerMuseumId, minimumRole: "operator" });
  const visit = new Visit({ kind: normalized.kind, createdBy: actor._id, ownerMuseumId: normalized.kind === "official" ? normalized.ownerMuseumId : null });
  await visit.save();
  let revision = null;
  try {
    revision = new VisitRevision({
      visitId: visit._id,
      version: 1,
      title: normalized.title,
      description: normalized.description,
      defaultPresentationPolicy: normalized.defaultPresentationPolicy || null,
      contentEntries: normalized.contentEntries || [],
      logistics: normalized.logistics || { preVisitNotes: [], routeHints: [] },
      baselineTiming: {},
      status: "draft",
      integrity: { status: "needs_review", issues: [] },
      createdBy: actor._id,
      updatedBy: actor._id,
    });
    await revision.save();
    const pointer = await Visit.updateOne(
      { _id: visit._id, workingRevisionId: null, publishedRevisionId: null, lifecycleStatus: "active" },
      { $set: { workingRevisionId: revision._id } },
    );
    if (pointer.modifiedCount !== 1) throw new AppError("La visita e cambiata durante la creazione", 409);
    visit.workingRevisionId = revision._id;
    return { visit, revision };
  } catch (error) {
    if (revision?._id) await VisitRevision.deleteOne({ _id: revision._id }).catch(() => {});
    await visit.deleteOne().catch(() => {});
    throw error;
  }
}
async function updateVisit({ visitId, payload, actorUserId }) {
  rejectManagedFields(payload);
  const visit = await findVisitOrFail(visitId);
  await assertVisitEditor({ visit, actorUserId });
  if (hasOwn(payload, "kind") || hasOwn(payload, "ownerMuseumId")) throw new AppError("kind e ownerMuseumId sono immutabili dopo la creazione", 409);
  const revision = await getWorkingRevision(visit, actorUserId);
  try { markRevisionEdited(revision, actorUserId); } catch (error) { throw new AppError(error.message, 409, [{ code: error.code }]); }
  const normalized = normalizeVisitPayload(payload);
  const merged = mergeRevisionPayload(revision, payload, normalized);
  const validationPayload = { ...merged, kind: visit.kind, ownerMuseumId: visit.ownerMuseumId };
  const errors = validateVisitDraftPayload({ payload: validationPayload, kind: visit.kind, mode: "create" });
  if (errors.length) throw new AppError("Payload non valido", 400, errors);
  Object.assign(revision, merged);
  revision.baselineTiming = {};
  revision.updatedBy = actorUserId;
  await revision.save();
  return { visit, revision };
}
async function actorCanManage(visit, actorUserId) {
  if (!actorUserId) return false;
  const user = await User.findOne({ _id: actorUserId, status: "active" }).lean();
  if (!user) return false;
  if (visit.kind === "community") return String(visit.createdBy) === String(user._id);
  return hasMuseumRole(user, visit.ownerMuseumId, "operator");
}
async function getVisit({ visitId, actorUserId = null, view = "published" }) {
  const visit = await findVisitOrFail(visitId, { includeTrashed: view === "working" });
  const canManage = await actorCanManage(visit, actorUserId);
  if (view === "working" && !canManage) throw new AppError("Accesso alla revisione di lavoro non autorizzato", 403);
  const revisionId = view === "working" && visit.workingRevisionId ? visit.workingRevisionId : visit.publishedRevisionId;
  if (!revisionId) throw new AppError("Nessuna revisione disponibile", 404);
  const revision = await VisitRevision.findById(revisionId);
  if (!revision) throw new AppError("Revisione non trovata", 404);
  return { visit, revision };
}
async function listPublishedVisits({ kind, ownerMuseumId, includedMuseumId }) {
  const visits = await Visit.find({ lifecycleStatus: "active", publishedRevisionId: { $ne: null }, ...(kind ? { kind } : {}), ...(ownerMuseumId ? { ownerMuseumId } : {}) }).sort({ updatedAt: -1 }).lean();
  const results = [];
  for (const visit of visits) {
    const revision = await VisitRevision.findById(visit.publishedRevisionId).lean();
    if (!revision) continue;
    if (includedMuseumId && !revision.museumIds.some((id) => String(id) === String(includedMuseumId))) continue;
    results.push({ visit, revision });
  }
  return results;
}
async function listManageableVisits(actorUserId) {
  const user = await getActiveUserOrFail(actorUserId);
  const museumIds = (user.memberships || []).filter((entry) => ["operator", "manager"].includes(entry.role)).map((entry) => entry.museumId);
  const visits = await Visit.find({ $or: [{ kind: "community", createdBy: user._id }, { kind: "official", ownerMuseumId: { $in: museumIds } }] }).sort({ updatedAt: -1 }).lean();
  const results = [];
  for (const visit of visits) {
    const revisionId = visit.workingRevisionId || visit.publishedRevisionId;
    const revision = revisionId ? await VisitRevision.findById(revisionId).lean() : null;
    results.push({ visit, revision });
  }
  return results;
}
async function trashVisit({ visitId, actorUserId }) {
  const visit = await findVisitOrFail(visitId);
  await assertVisitEditor({ visit, actorUserId });
  visit.lifecycleStatus = "trashed";
  visit.trashedAt = new Date();
  visit.trashedBy = actorUserId;
  await visit.save();
  return visit;
}
async function restoreVisit({ visitId, actorUserId }) {
  const visit = await findVisitOrFail(visitId, { includeTrashed: true });
  await assertVisitEditor({ visit, actorUserId, managerRequired: visit.kind === "official" });
  visit.lifecycleStatus = "active";
  visit.trashedAt = null;
  visit.trashedBy = null;
  await visit.save();
  return visit;
}
async function hardDeleteVisit({ visitId, actorUserId }) {
  const visit = await findVisitOrFail(visitId, { includeTrashed: true });
  await assertVisitEditor({ visit, actorUserId, managerRequired: visit.kind === "official" });
  if (visit.lifecycleStatus !== "trashed") throw new AppError("La visita deve essere nel cestino", 409);
  const revisionIds = await VisitRevision.find({ visitId: visit._id }).distinct("_id");
  const sessionIds = await VisitSession.find({ visitId: visit._id }).distinct("_id");
  await Promise.all([
    VisitRevision.deleteMany({ visitId: visit._id }),
    UserVisitPreference.deleteMany({ visitId: visit._id }),
    SessionPlanRevision.deleteMany({ sessionId: { $in: sessionIds } }),
    VisitSession.deleteMany({ visitId: visit._id }),
    VisitTimingProfile.deleteMany({ visitRevisionId: { $in: revisionIds } }),
  ]);
  await visit.deleteOne();
  return visit;
}

module.exports = { REVISION_FIELDS, findVisitOrFail, assertVisitEditor, getWorkingRevision, createVisit, updateVisit, listPublishedVisits, listManageableVisits, getVisit, trashVisit, restoreVisit, hardDeleteVisit };
