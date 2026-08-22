const { assertCapabilitySource } = require("./capabilityAuthorization.service");

async function assertCanUseNamespace({ namespace, actorUserId, capability = "namespace.author" }) {
  return assertCapabilitySource({
    actorUserId,
    capability,
    resourceType: "namespace",
    resourceId: namespace._id,
  });
}

async function assertCanUseNamespaceForAuthoring({ namespace, actorUserId }) {
  return assertCanUseNamespace({ namespace, actorUserId, capability: "namespace.author" });
}

async function assertCanUseNamespaceForEditorialContext({ namespace, actorUserId }) {
  return assertCanUseNamespace({ namespace, actorUserId, capability: "namespace.author" });
}

async function assertCanUseNamespaceForFork({ namespace, actorUserId }) {
  return assertCanUseNamespace({ namespace, actorUserId, capability: "namespace.fork" });
}

module.exports = {
  assertCanUseNamespace,
  assertCanUseNamespaceForAuthoring,
  assertCanUseNamespaceForEditorialContext,
  assertCanUseNamespaceForFork,
};
