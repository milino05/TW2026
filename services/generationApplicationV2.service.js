const GeneratedVisitPlanV2 = require("../models/generatedVisitPlanV2.model");
const generator = require("./visitGeneratorV2.service");
const { resolveCapabilityAccess } = require("./capabilityAuthorization.service");
const { recordAdoptionFromAccess, deleteAdoptions } = require("./marketplaceAdoptionV2.service");

function id(value) { return String(value?._id || value || ""); }

async function recordGenerationSourceAdoptions({ plan, actorUserId }) {
  const adoptionIds = [];
  for (const source of plan.contextSnapshot?.editorialSources || []) {
    const requested = source.requestedSourceRef;
    const editorialReleaseId = source.editorialReleaseId;
    if (!requested?.resourceType || !requested.resourceId || !editorialReleaseId) continue;
    const access = await resolveCapabilityAccess({
      actorUserId,
      capability: "context.generate",
      resourceType: requested.resourceType,
      resourceId: requested.resourceId,
    });
    if (!access.allowed) continue;
    const adoption = await recordAdoptionFromAccess({
      access: { ...access, requestedResourceRef: requested },
      actorUserId,
      action: "context_reference",
      sourceResourceRef: requested,
      sourceSnapshotRef: { resourceType: "editorial_release", resourceId: editorialReleaseId },
    });
    if (adoption) adoptionIds.push(adoption._id);
  }
  return adoptionIds;
}

async function generateVisitPlanForUserV2({ userId, request }) {
  const plan = await generator.generateVisitPlanV2({ userId, request });
  let adoptionIds = [];
  try {
    adoptionIds = await recordGenerationSourceAdoptions({ plan, actorUserId: userId });
    return plan;
  } catch (error) {
    await deleteAdoptions(adoptionIds).catch(() => {});
    await GeneratedVisitPlanV2.deleteOne({ _id: plan._id, userId, status: "proposed" }).catch(() => {});
    throw error;
  }
}

async function assertGenerationAdoptionSnapshot({ planId, editorialReleaseId }) {
  const plan = await GeneratedVisitPlanV2.findById(planId).select("sourceEditorialReleaseIds").lean();
  return Boolean(plan && (plan.sourceEditorialReleaseIds || []).some((releaseId) => id(releaseId) === id(editorialReleaseId)));
}

module.exports = {
  recordGenerationSourceAdoptions,
  generateVisitPlanForUserV2,
  assertGenerationAdoptionSnapshot,
};
