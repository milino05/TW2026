const GeneratedVisitPlanV2 = require("../models/generatedVisitPlanV2.model");
const generator = require("./visitGeneratorV2.service");
const { resolveCapabilityAccess } = require("./capabilityAuthorization.service");
const { recordAdoptionFromAccess, deleteAdoptions } = require("./marketplaceAdoptionV2.service");

async function resolveAdoptionAccess({ source, actorUserId }) {
  const requested = source.requestedSourceRef;
  let sourceResourceRef = requested;
  let access = await resolveCapabilityAccess({
    actorUserId,
    capability: "context.generate",
    resourceType: requested.resourceType,
    resourceId: requested.resourceId,
  });
  if (!access.allowed && source.resolvedSourceRef?.resourceType === "editorial_release") {
    sourceResourceRef = source.resolvedSourceRef;
    access = await resolveCapabilityAccess({
      actorUserId,
      capability: "context.generate",
      resourceType: sourceResourceRef.resourceType,
      resourceId: sourceResourceRef.resourceId,
    });
  }
  return { access, sourceResourceRef };
}

async function recordGenerationSourceAdoptions({ plan, actorUserId }) {
  const adoptionIds = [];
  try {
    for (const source of plan.contextSnapshot?.editorialSources || []) {
      const requested = source.requestedSourceRef;
      const editorialReleaseId = source.editorialReleaseId;
      if (!requested?.resourceType || !requested.resourceId || !editorialReleaseId) continue;
      const { access, sourceResourceRef } = await resolveAdoptionAccess({ source, actorUserId });
      if (!access.allowed) continue;
      const adoption = await recordAdoptionFromAccess({
        access: { ...access, requestedResourceRef: sourceResourceRef },
        actorUserId,
        action: "context_reference",
        sourceResourceRef,
        sourceSnapshotRef: { resourceType: "editorial_release", resourceId: editorialReleaseId },
      });
      if (adoption) adoptionIds.push(adoption._id);
    }
    return adoptionIds;
  } catch (error) {
    await deleteAdoptions(adoptionIds).catch(() => {});
    throw error;
  }
}

async function generateVisitPlanForUserV2({ userId, request }) {
  const plan = await generator.generateVisitPlanV2({ userId, request });
  try {
    await recordGenerationSourceAdoptions({ plan, actorUserId: userId });
    return plan;
  } catch (error) {
    await GeneratedVisitPlanV2.deleteOne({ _id: plan._id, userId, status: "proposed" }).catch(() => {});
    throw error;
  }
}

module.exports = {
  resolveAdoptionAccess,
  recordGenerationSourceAdoptions,
  generateVisitPlanForUserV2,
};
