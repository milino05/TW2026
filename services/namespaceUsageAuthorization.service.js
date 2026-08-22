const { assertCapabilitySource } = require("./capabilityAuthorization.service");

async function assertCanUseNamespace({ namespace, actorUserId, capability = "namespace.author", principalType = null, principalId = null }) {
  return assertCapabilitySource({
    actorUserId,
    capability,
    resourceType: "namespace",
    resourceId: namespace._id,
    principalType,
    principalId,
  });
}

async function assertCanUseNamespaceForAuthoring({ namespace, actorUserId, principalType = null, principalId = null }) {
  return assertCanUseNamespace({ namespace, actorUserId, capability: "namespace.author", principalType, principalId });
}

async function assertCanUseNamespaceForEditorialContext({ namespace, actorUserId, principalType = null, principalId = null }) {
  return assertCanUseNamespace({ namespace, actorUserId, capability: "namespace.author", principalType, principalId });
}

async function assertCanUseNamespaceForFork({ namespace, actorUserId, principalType = null, principalId = null }) {
  return assertCanUseNamespace({ namespace, actorUserId, capability: "namespace.fork", principalType, principalId });
}

module.exports = {
  assertCanUseNamespace,
  assertCanUseNamespaceForAuthoring,
  assertCanUseNamespaceForEditorialContext,
  assertCanUseNamespaceForFork,
};
