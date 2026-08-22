const { assertCanActForOwner } = require("./resourceOwnership.service");

/**
 * Temporary pre-Marketplace authorization boundary.
 *
 * The canonical Marketplace design will allow Entitlement capabilities such as
 * namespace.author / namespace.fork. Until those models are implemented, using
 * a Namespace outside its owner authority is denied conservatively rather than
 * treated as implicitly public. Consumers must call this boundary instead of
 * embedding ownership assumptions in Item/Context/Graph services.
 */
async function assertCanUseNamespace({ namespace, actorUserId, minimumOrganizationRole = "operator" }) {
  return assertCanActForOwner({
    actorUserId,
    ownerType: namespace.ownerType,
    ownerId: namespace.ownerId,
    minimumOrganizationRole,
  });
}

async function assertCanUseNamespaceForAuthoring({ namespace, actorUserId }) {
  return assertCanUseNamespace({ namespace, actorUserId });
}

async function assertCanUseNamespaceForEditorialContext({ namespace, actorUserId }) {
  return assertCanUseNamespace({ namespace, actorUserId });
}

async function assertCanUseNamespaceForFork({ namespace, actorUserId }) {
  return assertCanUseNamespace({ namespace, actorUserId });
}

module.exports = {
  assertCanUseNamespace,
  assertCanUseNamespaceForAuthoring,
  assertCanUseNamespaceForEditorialContext,
  assertCanUseNamespaceForFork,
};
