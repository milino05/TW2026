const { assertCanActForOwner } = require("./resourceOwnership.service");

/**
 * Policy boundary for using a Namespace in an EditorialContext.
 * Until namespace licensing/entitlements are modeled, usage requires authority
 * over the Namespace owner. Future usage grants belong here rather than in
 * EditorialContext or ContentSpace.
 */
async function assertCanUseNamespaceForEditorialContext({ namespace, actorUserId }) {
  return assertCanActForOwner({
    actorUserId,
    ownerType: namespace.ownerType,
    ownerId: namespace.ownerId,
    minimumOrganizationRole: "operator",
  });
}

module.exports = { assertCanUseNamespaceForEditorialContext };
