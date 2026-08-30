const VisitV2 = require("../models/visitV2.model");
const VisitRevisionV2 = require("../models/visitRevisionV2.model");
const Organization = require("../models/organization.model");
const AppError = require("../utils/AppError");
const { assertCanActForOwner } = require("./resourceOwnership.service");
const { getActiveUserOrFail } = require("./userAuthorization.service");
const { resolveActorPrincipals } = require("./principalResolution.service");
const { markRevisionEdited } = require("./revisionWorkflow.service");
const { normalizeVisitV2Payload, validateVisitV2Payload } = require("./validation/visitV2.validation");
const { cloneDetachedVisitRevision } = require("./visitV2Copy.service");
const { assertCapabilitySource } = require("./capabilityAuthorization.service");
const { authorizeVisitEditorialSources, authorizeVisitContentSources } = require("./visitEditorialUsageAuthorization.service");
const { recordAdoptionFromAccess, deleteAdoptions } = require("./marketplaceAdoptionV2.service");

const REVISION_FIELDS = ["title", "description", "contentSources", "editorialSources", "contentEntries", "visitAnchors", "presentationBaseline", "logistics"];
function hasOwn(obj, key) { return Object.prototype.hasOwnProperty.call(obj || {}, key); }
function plain(value) { return value?.toObject ? value.toObject() : value || {}; }
function sameId(a, b) { return String(a || "") === String(b || ""); }

async function assertOwnerUsable({ ownerType, ownerId, actorUserId, permissionCode = null }) {
  const actor = await assertCanActForOwner({ actorUserId, ownerType, ownerId, permissionCode });
  if (ownerType === "organization") {
    const organization = await Organization.exists({ _id: ownerId, lifecycleStatus: "active" });
    if (!organization) throw new AppError("Organization owner non disponibile", 404);
  }
  return actor;
}

async function findVisitV2OrFail(visitId, { includeTrashed = false } = {}) {
  const query = { _id: visitId };
  if (!includeTrashed) query.lifecycleStatus = "active";
  const visit = await VisitV2.findOne(query);
  if (!visit) throw new AppError("Visit v2 non trovata", 404);
  return visit;
}

async function assertCanManageVisitV2({ visit, actorUserId, permissionCode = "visit.edit" }) {
  return assertOwnerUsable({ ownerType: visit.ownerType, ownerId: visit.ownerId, actorUserId, permissionCode });
}

function revisionSnapshot(revision) {
  const source = plain(revision);
  return Object.fromEntries(REVISION_FIELDS.map((field) => [field, source[field]]));
}

function mergedRevisionPayload(revision, rawPayload, normalized) {
  const merged = revisionSnapshot(revision);
  for (const field of REVISION_FIELDS) if (hasOwn(rawPayload, field)) merged[field] = normalized[field];
  return merged;
}

function editorialReleaseIds(editorialSources = []) {
  return new Set((editorialSources || []).map((source) => String(source?.editorialReleaseId || "")).filter(Boolean));
}

function contentSourceKeys(contentSources = []) {
  return new Set((contentSources || []).map((source) => {
    const resourceId = source?.sourceType === "editorial_release" ? source?.editorialReleaseId : source?.itemRevisionId;
    return resourceId ? `${source.sourceType}:${String(resourceId)}` : "";
  }).filter(Boolean));
}

async function recordVisitSourceAdoptions({ authorizations, actorUserId, visitId, onlyReleaseIds = null }) {
  const adoptionIds = [];
  for (const authorization of authorizations || []) {
    const releaseId = String(authorization.release._id);
    if (onlyReleaseIds && !onlyReleaseIds.has(releaseId)) continue;
    const adoption = await recordAdoptionFromAccess({
      access: authorization.access,
      actorUserId,
      action: "context_reference",
      sourceResourceRef: { resourceType: "editorial_context", resourceId: authorization.context._id },
      sourceSnapshotRef: { resourceType: "editorial_release", resourceId: authorization.release._id },
      resultResourceRef: { resourceType: "visit", resourceId: visitId },
    });
    if (adoption) adoptionIds.push(adoption._id);
  }
  return adoptionIds;
}

async function recordVisitContentSourceAdoptions({ authorizations, actorUserId, visitId, onlySourceKeys = null }) {
  const adoptionIds = [];
  for (const authorization of authorizations || []) {
    const sourceId = authorization.sourceType === "editorial_release" ? authorization.release?._id : authorization.revision?._id;
    const sourceKey = `${authorization.sourceType}:${String(sourceId || "")}`;
    if (onlySourceKeys && !onlySourceKeys.has(sourceKey)) continue;
    if (authorization.sourceType === "editorial_release") {
      const adoption = await recordAdoptionFromAccess({
        access: authorization.access,
        actorUserId,
        action: "context_reference",
        sourceResourceRef: { resourceType: "editorial_context", resourceId: authorization.context._id },
        sourceSnapshotRef: { resourceType: "editorial_release", resourceId: authorization.release._id },
        resultResourceRef: { resourceType: "visit", resourceId: visitId },
      });
      if (adoption) adoptionIds.push(adoption._id);
      continue;
    }
    const adoption = await recordAdoptionFromAccess({
      access: authorization.access,
      actorUserId,
      action: "content_visit",
      sourceSnapshotRef: { resourceType: "item_revision", resourceId: authorization.revision._id },
      resultResourceRef: { resourceType: "visit", resourceId: visitId },
    });
    if (adoption) adoptionIds.push(adoption._id);
  }
  return adoptionIds;
}

async function nextVersion(visitId) {
  const latest = await VisitRevisionV2.findOne({ visitId }).sort({ version: -1 }).select("version").lean();
  return (latest?.version || 0) + 1;
}

async function createWorkingFromPublished({ visit, actorUserId }) {
  if (!visit.publishedRevisionId) throw new AppError("Nessuna revisione pubblicata da clonare", 409);
  const published = await VisitRevisionV2.findById(visit.publishedRevisionId);
  if (!published) throw new AppError("VisitRevision pubblicata non trovata", 409);
  const revision = await VisitRevisionV2.create({
    visitId: visit._id,
    version: await nextVersion(visit._id),
    basedOnRevisionId: published._id,
    ...revisionSnapshot(published),
    status: "draft",
    integrity: { status: "needs_review", issues: [] },
    review: {},
    publication: {},
    createdBy: actorUserId,
    updatedBy: actorUserId,
  });
  const pointer = await VisitV2.updateOne(
    { _id: visit._id, lifecycleStatus: "active", workingRevisionId: null, publishedRevisionId: published._id },
    { $set: { workingRevisionId: revision._id } },
  );
  if (pointer.modifiedCount !== 1) {
    await revision.deleteOne().catch(() => {});
    throw new AppError("La Visit e cambiata durante la creazione della working revision", 409);
  }
  visit.workingRevisionId = revision._id;
  return revision;
}

async function getWorkingVisitRevisionV2({ visit, actorUserId, createFromPublished = true }) {
  if (visit.workingRevisionId) {
    const revision = await VisitRevisionV2.findById(visit.workingRevisionId);
    if (!revision) throw new AppError("Working VisitRevision non trovata", 409);
    return revision;
  }
  if (createFromPublished && visit.publishedRevisionId) return createWorkingFromPublished({ visit, actorUserId });
  throw new AppError("La Visit non ha una working revision", 409);
}

async function createVisitV2({ payload, actorUserId }) {
  const normalized = normalizeVisitV2Payload(payload || {});
  const issues = validateVisitV2Payload({ payload: normalized, rawPayload: payload || {}, creating: true });
  if (issues.length) throw new AppError("Payload Visit v2 non valido", 400, issues);
  await assertOwnerUsable({ ownerType: normalized.ownerType, ownerId: normalized.ownerId, actorUserId, permissionCode: "visit.create" });
  const sourceAuthorizations = await authorizeVisitEditorialSources({
    editorialSources: normalized.editorialSources || [],
    actorUserId,
    principalType: normalized.ownerType,
    principalId: normalized.ownerId,
  });
  const contentSourceAuthorizations = await authorizeVisitContentSources({
    contentSources: normalized.contentSources || [],
    actorUserId,
    principalType: normalized.ownerType,
    principalId: normalized.ownerId,
  });
  const visit = await VisitV2.create({ ownerType: normalized.ownerType, ownerId: normalized.ownerId, createdBy: actorUserId });
  let revision;
  let adoptionIds = [];
  try {
    revision = await VisitRevisionV2.create({
      visitId: visit._id,
      version: 1,
      title: normalized.title,
      description: normalized.description || null,
      contentSources: normalized.contentSources || [],
      editorialSources: normalized.editorialSources || [],
      contentEntries: normalized.contentEntries || [],
      visitAnchors: normalized.visitAnchors || [],
      presentationBaseline: normalized.presentationBaseline || null,
      logistics: normalized.logistics || { preVisitNotes: [], routeHints: [] },
      createdBy: actorUserId,
      updatedBy: actorUserId,
    });
    visit.workingRevisionId = revision._id;
    await visit.save();
    adoptionIds = await recordVisitSourceAdoptions({ authorizations: sourceAuthorizations, actorUserId, visitId: visit._id });
    adoptionIds.push(...await recordVisitContentSourceAdoptions({ authorizations: contentSourceAuthorizations, actorUserId, visitId: visit._id }));
    return { visit, revision };
  } catch (error) {
    await deleteAdoptions(adoptionIds).catch(() => {});
    if (revision?._id) await VisitRevisionV2.deleteOne({ _id: revision._id }).catch(() => {});
    await visit.deleteOne().catch(() => {});
    throw error;
  }
}

async function updateVisitV2({ visitId, payload, actorUserId }) {
  const visit = await findVisitV2OrFail(visitId);
  await assertCanManageVisitV2({ visit, actorUserId, permissionCode: "visit.edit" });
  const normalized = normalizeVisitV2Payload(payload || {});
  const issues = validateVisitV2Payload({ payload: normalized, rawPayload: payload || {}, creating: false });
  if (issues.length) throw new AppError("Payload Visit v2 non valido", 400, issues);
  const revision = await getWorkingVisitRevisionV2({ visit, actorUserId });
  const beforeSourceIds = editorialReleaseIds(revision.editorialSources || []);
  const beforeContentSourceKeys = contentSourceKeys(revision.contentSources || []);
  const merged = mergedRevisionPayload(revision, payload || {}, normalized);
  const sourceAuthorizations = hasOwn(payload || {}, "editorialSources")
    ? await authorizeVisitEditorialSources({
        editorialSources: merged.editorialSources || [],
        actorUserId,
        principalType: visit.ownerType,
        principalId: visit.ownerId,
      })
    : [];
  const addedSourceIds = new Set([...editorialReleaseIds(merged.editorialSources || [])].filter((entry) => !beforeSourceIds.has(entry)));
  const contentSourceAuthorizations = hasOwn(payload || {}, "contentSources")
    ? await authorizeVisitContentSources({
        contentSources: merged.contentSources || [],
        actorUserId,
        principalType: visit.ownerType,
        principalId: visit.ownerId,
      })
    : [];
  const addedContentSourceKeys = new Set([...contentSourceKeys(merged.contentSources || [])].filter((entry) => !beforeContentSourceKeys.has(entry)));
  try { markRevisionEdited(revision, actorUserId); }
  catch (error) { throw new AppError(error.message, 409, [{ code: error.code }]); }
  Object.assign(revision, merged);
  revision.updatedBy = actorUserId;
  let adoptionIds = [];
  try {
    adoptionIds = await recordVisitSourceAdoptions({
      authorizations: sourceAuthorizations,
      actorUserId,
      visitId: visit._id,
      onlyReleaseIds: addedSourceIds,
    });
    adoptionIds.push(...await recordVisitContentSourceAdoptions({
      authorizations: contentSourceAuthorizations,
      actorUserId,
      visitId: visit._id,
      onlySourceKeys: addedContentSourceKeys,
    }));
    await revision.save();
    return { visit, revision };
  } catch (error) {
    await deleteAdoptions(adoptionIds).catch(() => {});
    throw error;
  }
}

async function getVisitV2({ visitId, actorUserId, view = "working" }) {
  const visit = await findVisitV2OrFail(visitId, { includeTrashed: view === "working" });
  await assertCanManageVisitV2({ visit, actorUserId, permissionCode: "visit.view" });
  const revisionId = view === "published" ? visit.publishedRevisionId : (visit.workingRevisionId || visit.publishedRevisionId);
  if (!revisionId) throw new AppError("Nessuna VisitRevision disponibile", 404);
  const revision = await VisitRevisionV2.findById(revisionId);
  if (!revision) throw new AppError("VisitRevision non trovata", 404);
  return { visit, revision };
}

async function listManageableVisitsV2({ actorUserId }) {
  const user = await getActiveUserOrFail(actorUserId);
  const { principals } = await resolveActorPrincipals(actorUserId);
  const organizationIds = principals
    .filter((entry) => entry.type === "organization" && entry.effectivePermissions.includes("visit.view"))
    .map((entry) => entry.id);
  const visits = await VisitV2.find({
    lifecycleStatus: "active",
    $or: [
      { ownerType: "user", ownerId: user._id },
      { ownerType: "organization", ownerId: { $in: organizationIds } },
    ],
  }).sort({ updatedAt: -1 }).lean();
  const result = [];
  for (const visit of visits) {
    const revisionId = visit.workingRevisionId || visit.publishedRevisionId;
    const revision = revisionId ? await VisitRevisionV2.findById(revisionId).lean() : null;
    result.push({ visit, revision });
  }
  return result;
}

async function copyVisitV2({ sourceVisitId, sourceRevisionId = null, ownerType, ownerId, title = null, actorUserId }) {
  await assertOwnerUsable({ ownerType, ownerId, actorUserId, permissionCode: "visit.create" });
  const sourceVisit = await findVisitV2OrFail(sourceVisitId);
  const access = await assertCapabilitySource({
    actorUserId,
    capability: "visit.copy_detached",
    resourceType: "visit",
    resourceId: sourceVisit._id,
    principalType: ownerType,
    principalId: ownerId,
  });
  let resolvedRevisionId = sourceRevisionId || access.resolvedSnapshotRef?.resourceId;
  if (!resolvedRevisionId && access.basis !== "entitlement") resolvedRevisionId = sourceVisit.publishedRevisionId;
  if (!resolvedRevisionId) throw new AppError("La Visit sorgente non ha una revisione copiabile autorizzata", 409);
  if (access.basis === "entitlement") {
    const ref = access.resolvedSnapshotRef;
    if (ref?.resourceType !== "visit_revision" || !sameId(ref.resourceId, resolvedRevisionId)) {
      throw new AppError("La VisitRevision richiesta non e autorizzata", 403, [{
        code: "VISIT_REVISION_NOT_AUTHORIZED",
        context: { requestedRevisionId: resolvedRevisionId, authorizedRevisionId: ref?.resourceId || null },
      }]);
    }
  }
  const sourceRevision = await VisitRevisionV2.findOne({ _id: resolvedRevisionId, visitId: sourceVisit._id, status: { $in: ["published", "superseded"] } });
  if (!sourceRevision) throw new AppError("La revisione sorgente deve essere immutabile e appartenere alla Visit", 409);
  const snapshot = cloneDetachedVisitRevision(sourceRevision, { title });
  const visit = await VisitV2.create({
    ownerType,
    ownerId,
    copiedFromVisitId: sourceVisit._id,
    copiedFromVisitRevisionId: sourceRevision._id,
    createdBy: actorUserId,
  });
  let revision;
  let adoptionIds = [];
  try {
    revision = await VisitRevisionV2.create({
      visitId: visit._id,
      version: 1,
      ...snapshot,
      status: "draft",
      integrity: { status: "needs_review", issues: [] },
      review: {},
      publication: {},
      createdBy: actorUserId,
      updatedBy: actorUserId,
    });
    visit.workingRevisionId = revision._id;
    await visit.save();
    const adoption = await recordAdoptionFromAccess({
      access,
      actorUserId,
      action: "visit_copy",
      sourceResourceRef: { resourceType: "visit", resourceId: sourceVisit._id },
      sourceSnapshotRef: { resourceType: "visit_revision", resourceId: sourceRevision._id },
      resultResourceRef: { resourceType: "visit", resourceId: visit._id },
    });
    if (adoption) adoptionIds.push(adoption._id);
    return { visit, revision, source: { visitId: sourceVisit._id, visitRevisionId: sourceRevision._id } };
  } catch (error) {
    await deleteAdoptions(adoptionIds).catch(() => {});
    if (revision?._id) await VisitRevisionV2.deleteOne({ _id: revision._id }).catch(() => {});
    await visit.deleteOne().catch(() => {});
    throw error;
  }
}

async function trashVisitV2({ visitId, actorUserId }) {
  const visit = await findVisitV2OrFail(visitId);
  await assertCanManageVisitV2({ visit, actorUserId, permissionCode: "visit.lifecycle.manage" });
  visit.lifecycleStatus = "trashed";
  visit.trashedAt = new Date();
  visit.trashedBy = actorUserId;
  await visit.save();
  return visit;
}

async function restoreVisitV2({ visitId, actorUserId }) {
  const visit = await findVisitV2OrFail(visitId, { includeTrashed: true });
  await assertCanManageVisitV2({ visit, actorUserId, permissionCode: "visit.lifecycle.manage" });
  visit.lifecycleStatus = "active";
  visit.trashedAt = null;
  visit.trashedBy = null;
  await visit.save();
  return visit;
}

module.exports = {
  REVISION_FIELDS,
  findVisitV2OrFail,
  assertCanManageVisitV2,
  getWorkingVisitRevisionV2,
  createVisitV2,
  updateVisitV2,
  getVisitV2,
  listManageableVisitsV2,
  copyVisitV2,
  trashVisitV2,
  restoreVisitV2,
};
