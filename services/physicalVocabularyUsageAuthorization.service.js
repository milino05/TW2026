const { assertCapabilitySource } = require("./capabilityAuthorization.service");

async function assertCanUsePhysicalVocabulary({
  physicalVocabulary,
  actorUserId,
  capability = "physical_vocabulary.author",
  principalType = null,
  principalId = null,
}) {
  return assertCapabilitySource({
    actorUserId,
    capability,
    resourceType: "physical_vocabulary",
    resourceId: physicalVocabulary._id,
    principalType,
    principalId,
  });
}

async function assertCanUsePhysicalVocabularyForFork(args) {
  return assertCanUsePhysicalVocabulary({ ...args, capability: "physical_vocabulary.fork" });
}

async function assertCanUsePhysicalVocabularyForAuthoring(args) {
  return assertCanUsePhysicalVocabulary({ ...args, capability: "physical_vocabulary.author" });
}

module.exports = {
  assertCanUsePhysicalVocabulary,
  assertCanUsePhysicalVocabularyForFork,
  assertCanUsePhysicalVocabularyForAuthoring,
};
