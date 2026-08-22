const mongoose = require("mongoose");
const GeneratedVisitPlanV2 = require("../models/generatedVisitPlanV2.model");
const VisitV2 = require("../models/visitV2.model");
const VisitRevisionV2 = require("../models/visitRevisionV2.model");
const AppError = require("../utils/AppError");
const { publishVisitV2 } = require("./visitV2Publication.service");

function id(value) { return String(value?._id || value || ""); }
function uniqueIds(values = []) { return [...new Set(values.map(id).filter(Boolean))]; }
function objectId() { return new mongoose.Types.ObjectId(); }
function resultProjection({ planId, visit, revision, alreadyMaterialized }) {
  return {
    planId,
    visitId: visit._id,
    visitRevisionId: revision._id,
    status: revision.status,
    alreadyMaterialized: Boolean(alreadyMaterialized),
  };
}

function buildPresentationBaseline(plan) {
  const snapshot = plan.contextSnapshot || {};
  const baseline = {
    depthPreference: snapshot.depthPreference ?? null,
    languageComplexityPreference: snapshot.languageComplexityPreference ?? null,
    locale: snapshot.locale || null,
  };
  return Object.values(baseline).some((value) => value !== null) ? baseline : null;
}

function materializedRevisionPayload(plan, { title = null } = {}) {
  const releaseIds = uniqueIds(plan.sourceEditorialReleaseIds || []);
  if (!releaseIds.length) {
    throw new AppError("GeneratedPlan privo di EditorialRelease sorgenti", 409, [{ code: "GENERATED_PLAN_EDITORIAL_SOURCES_MISSING" }]);
  }
  const editorialSources = releaseIds.map((releaseId) => ({ _id: objectId(), editorialReleaseId: releaseId }));
  const sourceIdByReleaseId = new Map(editorialSources.map((source) => [id(source.editorialReleaseId), source._id]));

  const anchorIdMap = new Map();
  const visitAnchors = (plan.visitAnchors || []).map((anchor) => {
    const nextId = objectId();
    anchorIdMap.set(id(anchor._id), nextId);
    return { _id: nextId, venueTargetId: anchor.venueTargetId };
  });
  if (!visitAnchors.length) {
    throw new AppError("GeneratedPlan privo di tappe fisiche", 409, [{ code: "GENERATED_PLAN_ANCHORS_MISSING" }]);
  }

  const contentEntries = (plan.contentEntries || []).map((entry, index) => {
    const entryReleaseIds = new Set((entry.sourceEditorialReleaseIds || []).map(id));
    const canonicalReleaseId = releaseIds.find((releaseId) => entryReleaseIds.has(releaseId));
    if (!canonicalReleaseId) {
      throw new AppError("ContentEntry generata senza provenance editoriale compatibile", 409, [{
        code: "GENERATED_CONTENT_SOURCE_UNRESOLVABLE",
        context: { contentEntryIndex: index, itemEditionId: entry.itemEditionId, itemRevisionId: entry.itemRevisionId },
      }]);
    }
    const deliveryAnchorId = entry.deliveryAnchorId ? anchorIdMap.get(id(entry.deliveryAnchorId)) : null;
    if (entry.deliveryAnchorId && !deliveryAnchorId) {
      throw new AppError("ContentEntry generata riferisce un Anchor non materializzabile", 409, [{
        code: "GENERATED_CONTENT_ANCHOR_UNRESOLVABLE",
        context: { contentEntryIndex: index, deliveryAnchorId: entry.deliveryAnchorId },
      }]);
    }
    return {
      _id: objectId(),
      editorialSourceId: sourceIdByReleaseId.get(canonicalReleaseId),
      itemId: entry.itemId,
      itemEditionId: entry.itemEditionId,
      itemRevisionId: entry.itemRevisionId,
      deliveryAnchorId: deliveryAnchorId || null,
      role: entry.role || "recommended",
    };
  });
  if (!contentEntries.length) {
    throw new AppError("GeneratedPlan privo di contenuti", 409, [{ code: "GENERATED_PLAN_CONTENT_MISSING" }]);
  }

  const routeHints = (plan.physicalRoute?.legs || [])
    .filter((leg) => leg.type === "inter_venue")
    .map((leg, index) => {
      const fromAnchorId = anchorIdMap.get(id(leg.fromAnchorId));
      const toAnchorId = anchorIdMap.get(id(leg.toAnchorId));
      if (!fromAnchorId || !toAnchorId) {
        throw new AppError("Trasferimento inter-Venue non materializzabile", 409, [{
          code: "GENERATED_TRANSFER_ANCHOR_UNRESOLVABLE",
          context: { legIndex: index },
        }]);
      }
      return {
        _id: objectId(),
        fromAnchorId,
        toAnchorId,
        type: "inter_venue",
        instructionOverride: leg.instruction || null,
        estimatedTransferSeconds: Number(leg.estimatedSeconds),
      };
    });

  return {
    title: String(title || "").trim() || "Visita generata",
    description: null,
    editorialSources,
    contentEntries,
    visitAnchors,
    presentationBaseline: buildPresentationBaseline(plan),
    logistics: { preVisitNotes: [], routeHints },
  };
}

async function loadMaterializedVisit(visitId, planId, userId) {
  const visit = await VisitV2.findOne({
    _id: visitId,
    materializedFromGeneratedPlanId: planId,
    ownerType: "user",
    ownerId: userId,
    lifecycleStatus: "active",
  }).lean();
  if (!visit) throw new AppError("Visit materializzata non disponibile", 409, [{ code: "MATERIALIZED_VISIT_UNAVAILABLE" }]);
  if (!visit.publishedRevisionId) {
    throw new AppError("Materializzazione già avviata ma non ancora pubblicata", 409, [{ code: "MATERIALIZATION_IN_PROGRESS" }]);
  }
  const revision = await VisitRevisionV2.findOne({ _id: visit.publishedRevisionId, visitId: visit._id, status: "published" }).lean();
  if (!revision) throw new AppError("VisitRevision materializzata non disponibile", 409, [{ code: "MATERIALIZED_VISIT_REVISION_UNAVAILABLE" }]);
  return { visit, revision };
}

async function materializeGeneratedPlanV2({ planId, userId, title = null }) {
  const plan = await GeneratedVisitPlanV2.findOne({ _id: planId, userId });
  if (!plan) throw new AppError("GeneratedVisitPlan non disponibile", 404);
  if (plan.status !== "accepted") {
    throw new AppError("Accettare il GeneratedVisitPlan prima di salvarlo come Visit", 409, [{ code: "GENERATED_PLAN_ACCEPTANCE_REQUIRED" }]);
  }
  if (plan.materializedVisitId) {
    const existing = await loadMaterializedVisit(plan.materializedVisitId, plan._id, userId);
    return resultProjection({ planId: plan._id, ...existing, alreadyMaterialized: true });
  }

  const existingByProvenance = await VisitV2.findOne({ materializedFromGeneratedPlanId: plan._id }).lean();
  if (existingByProvenance) {
    const existing = await loadMaterializedVisit(existingByProvenance._id, plan._id, userId);
    await GeneratedVisitPlanV2.updateOne({ _id: plan._id, materializedVisitId: null }, { $set: { materializedVisitId: existing.visit._id } });
    return resultProjection({ planId: plan._id, ...existing, alreadyMaterialized: true });
  }

  const payload = materializedRevisionPayload(plan.toObject(), { title });
  let visit;
  let revision;
  let published = null;
  try {
    visit = await VisitV2.create({
      ownerType: "user",
      ownerId: userId,
      materializedFromGeneratedPlanId: plan._id,
      createdBy: userId,
    });
  } catch (error) {
    if (error?.code === 11000) {
      const concurrent = await VisitV2.findOne({ materializedFromGeneratedPlanId: plan._id }).lean();
      if (concurrent) {
        const existing = await loadMaterializedVisit(concurrent._id, plan._id, userId);
        return resultProjection({ planId: plan._id, ...existing, alreadyMaterialized: true });
      }
    }
    throw error;
  }

  try {
    revision = await VisitRevisionV2.create({
      visitId: visit._id,
      version: 1,
      ...payload,
      status: "draft",
      integrity: { status: "needs_review", issues: [] },
      createdBy: userId,
      updatedBy: userId,
    });
    visit.workingRevisionId = revision._id;
    await visit.save();

    published = await publishVisitV2({ visitId: visit._id, actorUserId: userId });
    const pointer = await GeneratedVisitPlanV2.updateOne(
      { _id: plan._id, userId, materializedVisitId: null },
      { $set: { materializedVisitId: visit._id } },
    );
    if (pointer.modifiedCount !== 1) {
      const refreshed = await GeneratedVisitPlanV2.findById(plan._id).select("materializedVisitId").lean();
      if (id(refreshed?.materializedVisitId) !== id(visit._id)) {
        throw new AppError("GeneratedPlan modificato durante la materializzazione", 409, [{ code: "GENERATED_PLAN_MATERIALIZATION_CONFLICT" }]);
      }
    }
    return resultProjection({ planId: plan._id, visit: published.visit, revision: published.revision, alreadyMaterialized: false });
  } catch (error) {
    if (!published) {
      await VisitRevisionV2.deleteMany({ visitId: visit._id }).catch(() => {});
      await VisitV2.deleteOne({ _id: visit._id, publishedRevisionId: null }).catch(() => {});
    }
    throw error;
  }
}

module.exports = {
  buildPresentationBaseline,
  materializedRevisionPayload,
  materializeGeneratedPlanV2,
};
