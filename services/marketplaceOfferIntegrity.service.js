const ItemRevisionV2 = require("../models/itemRevisionV2.model");
const EditorialRelease = require("../models/editorialRelease.model");
const VisitRevisionV2 = require("../models/visitRevisionV2.model");
const AppError = require("../utils/AppError");
const {
  resolveMarketableResource,
  resolveResourceAuthority,
} = require("./marketplaceResourceV2.service");

function id(value) { return String(value?._id || value || ""); }
function refKey(ref) { return `${ref.resourceType}:${id(ref.resourceId)}`; }
function samePrincipal(aType, aId, bType, bId) {
  return aType === bType && id(aId) === id(bId);
}

async function snapshotDependencies(ref) {
  if (["namespace_revision", "physical_vocabulary_revision"].includes(ref.resourceType)) return [];

  if (ref.resourceType === "item_revision") {
    const revision = await ItemRevisionV2.findById(ref.resourceId).lean();
    if (!revision) throw new AppError("ItemRevision dipendente non disponibile", 409, [{ code: "MARKETPLACE_DEPENDENCY_NOT_FOUND", context: ref }]);
    return [{ resourceType: "namespace_revision", resourceId: revision.authoredAgainstNamespaceRevisionId }];
  }

  if (ref.resourceType === "editorial_release") {
    const release = await EditorialRelease.findById(ref.resourceId).lean();
    if (!release) throw new AppError("EditorialRelease dipendente non disponibile", 409, [{ code: "MARKETPLACE_DEPENDENCY_NOT_FOUND", context: ref }]);
    return [
      { resourceType: "namespace_revision", resourceId: release.namespaceRevisionId },
      ...(release.itemBindings || []).map((binding) => ({ resourceType: "item_revision", resourceId: binding.itemRevisionId })),
    ];
  }

  if (ref.resourceType === "visit_revision") {
    const revision = await VisitRevisionV2.findById(ref.resourceId).lean();
    if (!revision) throw new AppError("VisitRevision dipendente non disponibile", 409, [{ code: "MARKETPLACE_DEPENDENCY_NOT_FOUND", context: ref }]);
    return [
      ...(revision.editorialSources || []).map((source) => ({ resourceType: "editorial_release", resourceId: source.editorialReleaseId })),
      ...(revision.contentEntries || []).map((entry) => ({ resourceType: "item_revision", resourceId: entry.itemRevisionId })),
    ];
  }

  return [];
}

async function resolveOfferDependencyIntegrity({ grants, sellerType, sellerId }) {
  const roots = [];
  for (const grant of grants || []) {
    const marketable = await resolveMarketableResource({ resourceType: grant.resourceType, resourceId: grant.resourceId });
    if (!samePrincipal(marketable.ownerType, marketable.ownerId, sellerType, sellerId)) {
      throw new AppError("Il seller non possiede una risorsa concessa dall'Offer", 403, [{
        code: "SELLER_GRANT_AUTHORITY_REQUIRED",
        context: { resourceType: grant.resourceType, resourceId: grant.resourceId },
      }]);
    }
    if (!marketable.snapshotRef) {
      throw new AppError("Snapshot del grant non disponibile", 409, [{ code: "PINNED_SNAPSHOT_UNAVAILABLE" }]);
    }
    roots.push(marketable.snapshotRef);
  }

  const rootKeys = new Set(roots.map(refKey));
  const visited = new Set();
  const queue = [...roots];
  const selfContainedDependencies = [];
  const externalRequirements = [];

  while (queue.length) {
    const current = queue.shift();
    const currentKey = refKey(current);
    if (visited.has(currentKey)) continue;
    visited.add(currentKey);

    const dependencies = await snapshotDependencies(current);
    for (const dependency of dependencies) {
      const key = refKey(dependency);
      if (!visited.has(key)) queue.push(dependency);
      if (rootKeys.has(key)) continue;

      const authority = await resolveResourceAuthority(dependency.resourceType, dependency.resourceId);
      if (!authority) {
        throw new AppError("Dipendenza Marketplace non disponibile", 409, [{
          code: "MARKETPLACE_DEPENDENCY_NOT_FOUND",
          context: dependency,
        }]);
      }
      const projected = {
        resourceType: dependency.resourceType,
        resourceId: dependency.resourceId,
        ownerType: authority.ownerType,
        ownerId: authority.ownerId,
      };
      const target = samePrincipal(authority.ownerType, authority.ownerId, sellerType, sellerId)
        ? selfContainedDependencies
        : externalRequirements;
      if (!target.some((entry) => refKey(entry) === key)) target.push(projected);
    }
  }

  return {
    status: externalRequirements.length ? "external_requirements" : "self_contained",
    selfContainedDependencies,
    externalRequirements,
    checkedAt: new Date(),
  };
}

async function assertSelfContainedOffer(args) {
  const integrity = await resolveOfferDependencyIntegrity(args);
  if (integrity.externalRequirements.length) {
    throw new AppError("L'Offer dipende da asset esterni che il seller non puo redistribuire", 409, [{
      code: "MARKETPLACE_EXTERNAL_DEPENDENCIES_NOT_SUPPORTED",
      context: { externalRequirements: integrity.externalRequirements },
    }]);
  }
  return integrity;
}

module.exports = {
  snapshotDependencies,
  resolveOfferDependencyIntegrity,
  assertSelfContainedOffer,
};
