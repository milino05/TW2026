const contentSpaceService = require("./contentSpace.service");
const contentSpaceItemDetailService = require("./contentSpaceItemDetail.service");
const { resolveOrganizationAuthority } = require("./organizationAuthorization.service");
const { listMarketplaceForkOptionsForSubject } = require("./marketplaceSubjectForkOptions.service");

async function canAcquireForPrincipal(contentSpace, actorUserId) {
  if (contentSpace.ownerType === "user") return true;
  const authority = await resolveOrganizationAuthority({
    userId: actorUserId,
    organizationId: contentSpace.ownerId,
  });
  return new Set(authority?.effectivePermissions || []).has("marketplace.acquire");
}

async function getItemAddContext({ contentSpaceId, subjectId, actorUserId }) {
  const baseContext = await contentSpaceItemDetailService.getItemAddContext({
    contentSpaceId,
    subjectId,
    actorUserId,
  });
  const contentSpace = await contentSpaceService.findContentSpaceOrFail({ contentSpaceId });
  const canAcquire = await canAcquireForPrincipal(contentSpace, actorUserId);
  const marketplaceOptions = (baseContext.ownedItems || []).length
    ? []
    : await listMarketplaceForkOptionsForSubject({
      subjectId,
      ownerType: contentSpace.ownerType,
      ownerId: contentSpace.ownerId,
      actorUserId,
    });

  return {
    ...baseContext,
    marketplaceOptions,
    availableOperations: {
      ...baseContext.availableOperations,
      canAcquireAndForkMarketplaceItem: Boolean(baseContext.availableOperations?.canCreateItem && canAcquire),
    },
  };
}

module.exports = { getItemAddContext };
