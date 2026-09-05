const test = require("node:test");
const assert = require("node:assert/strict");
const mongoose = require("mongoose");
const { getCommercialManagement } = require("../services/marketplaceCommercialV2.service");
const { createEditorialContextWithGraph } = require("./helpers/editorialGraphFixture");

const mongoUri = process.env.MONGO_URI;

async function withFreshDatabase(callback) {
  await mongoose.connect(mongoUri, { serverSelectionTimeoutMS: 10000 });
  try { await mongoose.connection.dropDatabase(); return await callback(); }
  finally { await mongoose.connection.dropDatabase().catch(() => {}); await mongoose.disconnect(); }
}

async function users(User, suffix) {
  return User.create([
    { username: `removal-owner-${suffix}`, passwordHash: "test-hash" },
    { username: `removal-buyer-${suffix}`, passwordHash: "test-hash" },
  ]);
}

async function assertRemovedFromSales(owner, message) {
  const commercial = await getCommercialManagement({ actorUserId: owner._id });
  assert.equal(commercial.total, 0, message);
  assert.deepEqual(commercial.listings, []);
}

async function publishedNamespace({ Namespace, NamespaceRevision, owner, name }) {
  const namespace = await Namespace.create({ name, ownerType: "user", ownerId: owner._id, createdBy: owner._id });
  const revision = await NamespaceRevision.create({
    namespaceId: namespace._id,
    version: 1,
    durationTypes: [{ definitionId: "duration:medium", key: "medium", label: "Media", targetSeconds: 120 }],
    languageLevels: [{ definitionId: "language:simple", key: "simple", label: "Semplice" }],
    status: "published",
    integrity: { status: "valid", issues: [], checkedAt: new Date(), checkedBy: owner._id },
    publication: { publishedAt: new Date(), publishedBy: owner._id },
    createdBy: owner._id,
    updatedBy: owner._id,
  });
  namespace.publishedRevisionId = revision._id;
  await namespace.save();
  return { namespace, revision };
}

async function publishedListingWithOffer({ MarketplaceListing, MarketplaceOffer, owner, resourceType, resourceId, capability, versionPolicy = "pin_at_acquisition" }) {
  const listing = await MarketplaceListing.create({
    sellerType: "user",
    sellerId: owner._id,
    resourceType,
    resourceId,
    title: `Listing ${resourceType}`,
    status: "published",
    publishedAt: new Date(),
    createdBy: owner._id,
  });
  const offer = await MarketplaceOffer.create({
    listingId: listing._id,
    label: "Offerta da rimuovere",
    pricing: { type: "free" },
    grants: [{ resourceType, resourceId, capability, versionPolicy }],
    status: "active",
    createdBy: owner._id,
  });
  return { listing, offer };
}

test("rimuovere un contenuto lo archivia e preserva storico, diritti, adozioni e snapshot", { skip: !mongoUri }, async () => {
  await withFreshDatabase(async () => {
    const User = require("../models/user");
    const Subject = require("../models/subject.model");
    const Namespace = require("../models/namespace.model");
    const NamespaceRevision = require("../models/namespaceRevision.model");
    const ItemV2 = require("../models/itemV2.model");
    const ItemEdition = require("../models/itemEdition.model");
    const ItemRevisionV2 = require("../models/itemRevisionV2.model");
    const MarketplaceListing = require("../models/marketplaceListing.model");
    const MarketplaceOffer = require("../models/marketplaceOffer.model");
    const MarketplaceAcquisition = require("../models/marketplaceAcquisition.model");
    const Entitlement = require("../models/entitlement.model");
    const { Adoption } = require("../models/adoption.model");
    const marketplace = require("../services/marketplaceV2.service");
    const { removeOwnedWorkspaceResource } = require("../services/marketplaceResourceRemovalV2.service");
    const { listCreatorWorkspaceResources } = require("../services/marketplaceWorkspaceResourcesV2.service");
    const { resolveCapabilitySource } = require("../services/capabilityAuthorization.service");

    const [owner, buyer] = await users(User, "content");
    const { namespace, revision: namespaceRevision } = await publishedNamespace({ Namespace, NamespaceRevision, owner, name: "Regole per il contenuto" });
    const subject = await Subject.create({ preferredLabel: "Soggetto rimozione", createdBy: owner._id });
    const item = await ItemV2.create({ primarySubjectId: subject._id, ownerType: "user", ownerId: owner._id, createdBy: owner._id });
    const edition = await ItemEdition.create({ itemId: item._id, namespaceId: namespace._id, createdBy: owner._id });
    const revision = await ItemRevisionV2.create({
      itemEditionId: edition._id,
      version: 1,
      authoredAgainstNamespaceRevisionId: namespaceRevision._id,
      label: "Contenuto da eliminare",
      authorCredits: [owner.username],
      metadata: { license: "CC BY 4.0" },
      status: "published",
      integrity: { status: "valid", issues: [], checkedAt: new Date(), checkedBy: owner._id },
      publication: { publishedAt: new Date(), publishedBy: owner._id },
      createdBy: owner._id,
      updatedBy: owner._id,
    });
    edition.publishedRevisionId = revision._id;
    await edition.save();
    const { listing, offer } = await publishedListingWithOffer({
      MarketplaceListing, MarketplaceOffer, owner,
      resourceType: "item_edition", resourceId: edition._id, capability: "content.consume",
    });
    const snapshotPublication = await publishedListingWithOffer({
      MarketplaceListing, MarketplaceOffer, owner,
      resourceType: "item_revision", resourceId: revision._id, capability: "content.consume", versionPolicy: "pinned",
    });
    const acquired = await marketplace.acquireOffer({ offerId: offer._id, actorUserId: buyer._id });
    const entitlement = acquired.entitlements[0];
    await Adoption.create({
      beneficiaryType: "user", beneficiaryId: buyer._id, entitlementId: entitlement._id,
      sourceResourceRef: { resourceType: "item_edition", resourceId: edition._id },
      sourceSnapshotRef: { resourceType: "item_revision", resourceId: revision._id },
      action: "content_link", adoptedBy: buyer._id,
    });

    const result = await removeOwnedWorkspaceResource({
      actorUserId: owner._id, resourceType: "item_edition", resourceId: edition._id,
    });
    assert.equal(result.lifecycleStatus, "trashed");
    assert.equal(result.withdrawnListingCount, 2);
    assert.equal(result.inactiveOfferCount, 2);
    assert.equal((await ItemV2.findById(item._id).lean()).lifecycleStatus, "trashed");
    assert.equal((await MarketplaceListing.findById(listing._id).lean()).status, "withdrawn");
    assert.equal((await MarketplaceOffer.findById(offer._id).lean()).status, "inactive");
    assert.equal((await MarketplaceListing.findById(snapshotPublication.listing._id).lean()).status, "withdrawn");
    assert.equal((await MarketplaceOffer.findById(snapshotPublication.offer._id).lean()).status, "inactive");
    assert.equal(await MarketplaceAcquisition.countDocuments({ _id: acquired.acquisition._id }), 1);
    assert.equal((await Entitlement.findById(entitlement._id).lean()).status, "active");
    assert.equal(await Adoption.countDocuments({ entitlementId: entitlement._id }), 1);

    await assertRemovedFromSales(owner, "removed content and its snapshots must disappear from sales");

    const owned = await listCreatorWorkspaceResources({ actorUserId: owner._id, ownership: "owned", resourceTypes: ["item_edition"] });
    assert.equal(owned.total, 0);
    const licensed = await listCreatorWorkspaceResources({ actorUserId: buyer._id, ownership: "licensed" });
    assert.equal(licensed.results.length, 1);
    assert.equal(licensed.results[0].resourceType, "item_revision");
    assert.equal(licensed.results[0].title, "Contenuto da eliminare");
    const access = await resolveCapabilitySource({
      actorUserId: buyer._id, capability: "content.consume", resourceType: "item_revision", resourceId: revision._id,
    });
    assert.equal(access.allowed, true);
    assert.equal(String(access.resolvedSnapshotRef.resourceId), String(revision._id));
  });
});

test("rimuovere regole editoriali mantiene utilizzabile la revisione già acquisita", { skip: !mongoUri }, async () => {
  await withFreshDatabase(async () => {
    const User = require("../models/user");
    const Namespace = require("../models/namespace.model");
    const NamespaceRevision = require("../models/namespaceRevision.model");
    const MarketplaceListing = require("../models/marketplaceListing.model");
    const MarketplaceOffer = require("../models/marketplaceOffer.model");
    const MarketplaceAcquisition = require("../models/marketplaceAcquisition.model");
    const Entitlement = require("../models/entitlement.model");
    const { Adoption } = require("../models/adoption.model");
    const marketplace = require("../services/marketplaceV2.service");
    const { removeOwnedWorkspaceResource } = require("../services/marketplaceResourceRemovalV2.service");
    const { getMarketplaceAuthoringPreflight } = require("../services/marketplaceAuthoringPreflightV2.service");

    const [owner, buyer] = await users(User, "namespace");
    const { namespace, revision } = await publishedNamespace({ Namespace, NamespaceRevision, owner, name: "Regole da eliminare" });
    const { listing, offer } = await publishedListingWithOffer({
      MarketplaceListing, MarketplaceOffer, owner,
      resourceType: "namespace", resourceId: namespace._id, capability: "namespace.author",
    });
    const acquired = await marketplace.acquireOffer({ offerId: offer._id, actorUserId: buyer._id });
    const entitlement = acquired.entitlements[0];
    await Adoption.create({
      beneficiaryType: "user", beneficiaryId: buyer._id, entitlementId: entitlement._id,
      sourceResourceRef: { resourceType: "namespace", resourceId: namespace._id },
      sourceSnapshotRef: { resourceType: "namespace_revision", resourceId: revision._id },
      action: "namespace_use", adoptedBy: buyer._id,
    });

    await removeOwnedWorkspaceResource({ actorUserId: owner._id, resourceType: "namespace", resourceId: namespace._id });
    const removedNamespace = await Namespace.findById(namespace._id).lean();
    assert.equal(removedNamespace.lifecycleStatus, "trashed");
    assert.equal(String(removedNamespace.trashedBy), String(owner._id));
    assert.equal((await MarketplaceListing.findById(listing._id).lean()).status, "withdrawn");
    assert.equal((await MarketplaceOffer.findById(offer._id).lean()).status, "inactive");
    assert.equal(await MarketplaceAcquisition.countDocuments({ _id: acquired.acquisition._id }), 1);
    assert.equal((await Entitlement.findById(entitlement._id).lean()).status, "active");
    assert.equal(await Adoption.countDocuments({ entitlementId: entitlement._id }), 1);
    await assertRemovedFromSales(owner, "removed namespaces must disappear from sales");

    const preflight = await getMarketplaceAuthoringPreflight({ actorUserId: buyer._id });
    assert.equal(preflight.content.allowed, true);
    assert.equal(preflight.content.usableNamespaces.length, 1);
    assert.equal(String(preflight.content.usableNamespaces[0].revisionId), String(revision._id));
    assert.equal(preflight.content.usableNamespaces[0].source, "licensed");
  });
});

test("rimuovere una raccolta preserva grafo, relazioni, release e diritti acquisiti", { skip: !mongoUri }, async () => {
  await withFreshDatabase(async () => {
    const User = require("../models/user");
    const Subject = require("../models/subject.model");
    const Namespace = require("../models/namespace.model");
    const NamespaceRevision = require("../models/namespaceRevision.model");
    const ContentSpace = require("../models/contentSpace.model");
    const EditorialContext = require("../models/editorialContext.model");
    const EditorialRelease = require("../models/editorialRelease.model");
    const SemanticGraph = require("../models/semanticGraph.model");
    const SemanticEdgeV2 = require("../models/semanticEdgeV2.model");
    const MarketplaceListing = require("../models/marketplaceListing.model");
    const MarketplaceOffer = require("../models/marketplaceOffer.model");
    const MarketplaceAcquisition = require("../models/marketplaceAcquisition.model");
    const Entitlement = require("../models/entitlement.model");
    const { Adoption } = require("../models/adoption.model");
    const marketplace = require("../services/marketplaceV2.service");
    const { removeOwnedWorkspaceResource } = require("../services/marketplaceResourceRemovalV2.service");
    const { listCreatorWorkspaceResources, getCreatorWorkspaceResourceDetail } = require("../services/marketplaceWorkspaceResourcesV2.service");
    const { resolveCapabilitySource } = require("../services/capabilityAuthorization.service");

    const [owner, buyer] = await users(User, "context");
    const { namespace, revision: namespaceRevision } = await publishedNamespace({ Namespace, NamespaceRevision, owner, name: "Regole collegamenti" });
    const space = await ContentSpace.create({ name: "Collegamenti personali", ownerType: "user", ownerId: owner._id, createdBy: owner._id });
    const { context, semanticGraph, graphRevision: graph } = await createEditorialContextWithGraph({
      contentSpace: space,
      namespaceId: namespace._id,
      namespaceRevisionId: namespaceRevision._id,
      displayName: "Collegamenti personali",
      shortDescription: "Raccolta da eliminare",
      createdBy: owner._id,
    });
    const [source, targetOne, targetTwo] = await Subject.create([
      { preferredLabel: "Sorgente", createdBy: owner._id },
      { preferredLabel: "Destinazione uno", createdBy: owner._id },
      { preferredLabel: "Destinazione due", createdBy: owner._id },
    ]);
    await SemanticEdgeV2.create([
      { graphRevisionId: graph._id, sourceSubjectId: source._id, targetSubjectId: targetOne._id, relationTypeDefinitionId: "related", weight: 5 },
      { graphRevisionId: graph._id, sourceSubjectId: source._id, targetSubjectId: targetTwo._id, relationTypeDefinitionId: "related", weight: 5 },
    ]);
    const release = await EditorialRelease.create({
      editorialContextId: context._id,
      version: 1,
      namespaceRevisionId: namespaceRevision._id,
      graphRevisionId: graph._id,
      itemBindings: [],
      integrity: { status: "valid", issues: [], checkedAt: new Date(), checkedBy: owner._id },
      releasedAt: new Date(),
      releasedBy: owner._id,
    });
    context.publishedReleaseId = release._id;
    await context.save();

    const livePublication = await publishedListingWithOffer({
      MarketplaceListing, MarketplaceOffer, owner,
      resourceType: "editorial_context", resourceId: context._id, capability: "context.generate", versionPolicy: "follow_current",
    });
    const snapshotPublication = await publishedListingWithOffer({
      MarketplaceListing, MarketplaceOffer, owner,
      resourceType: "editorial_release", resourceId: release._id, capability: "context.generate", versionPolicy: "pinned",
    });
    const acquired = await marketplace.acquireOffer({ offerId: livePublication.offer._id, actorUserId: buyer._id });
    const entitlement = acquired.entitlements[0];
    await Adoption.create({
      beneficiaryType: "user", beneficiaryId: buyer._id, entitlementId: entitlement._id,
      sourceResourceRef: { resourceType: "editorial_context", resourceId: context._id },
      sourceSnapshotRef: { resourceType: "editorial_release", resourceId: release._id },
      action: "context_reference", adoptedBy: buyer._id,
    });

    const detail = await getCreatorWorkspaceResourceDetail({
      actorUserId: owner._id, ownership: "owned", resourceType: "editorial_context", resourceId: context._id,
    });
    assert.equal(detail.asset.removalImpact.semanticGraphRelationCount, 2);
    assert.equal(detail.asset.removalImpact.semanticGraphCollectionCount, 1);

    const result = await removeOwnedWorkspaceResource({
      actorUserId: owner._id, resourceType: "editorial_context", resourceId: context._id,
    });
    assert.equal(result.semanticGraphRelationCount, 2);
    assert.equal(result.semanticGraphCollectionCount, 1);
    assert.equal(result.withdrawnListingCount, 2);
    assert.equal(result.inactiveOfferCount, 2);
    assert.equal((await EditorialContext.findById(context._id).lean()).lifecycleStatus, "trashed");
    assert.equal((await ContentSpace.findById(space._id).lean()).lifecycleStatus, "active");
    assert.equal((await Namespace.findById(namespace._id).lean()).lifecycleStatus, "active");
    const storedGraph = await SemanticGraph.findById(semanticGraph._id).lean();
    assert.ok(storedGraph);
    assert.equal(storedGraph.lifecycleStatus, "active");
    assert.equal(String(storedGraph.workingRevisionId), String(graph._id));
    assert.equal(await SemanticEdgeV2.countDocuments({ graphRevisionId: graph._id }), 2);
    assert.equal(await EditorialRelease.countDocuments({ _id: release._id }), 1);
    assert.equal((await MarketplaceListing.findById(livePublication.listing._id).lean()).status, "withdrawn");
    assert.equal((await MarketplaceOffer.findById(livePublication.offer._id).lean()).status, "inactive");
    assert.equal((await MarketplaceListing.findById(snapshotPublication.listing._id).lean()).status, "withdrawn");
    assert.equal((await MarketplaceOffer.findById(snapshotPublication.offer._id).lean()).status, "inactive");
    assert.equal(await MarketplaceAcquisition.countDocuments({ _id: acquired.acquisition._id }), 1);
    assert.equal((await Entitlement.findById(entitlement._id).lean()).status, "active");
    assert.equal(await Adoption.countDocuments({ entitlementId: entitlement._id }), 1);
    await assertRemovedFromSales(owner, "removed contexts and releases must disappear from sales");

    const owned = await listCreatorWorkspaceResources({ actorUserId: owner._id, ownership: "owned", resourceTypes: ["editorial_context"] });
    assert.equal(owned.total, 0);
    const licensed = await listCreatorWorkspaceResources({ actorUserId: buyer._id, ownership: "licensed" });
    assert.equal(licensed.results.length, 1);
    assert.equal(licensed.results[0].resourceType, "editorial_release");
    const access = await resolveCapabilitySource({
      actorUserId: buyer._id, capability: "context.generate", resourceType: "editorial_context", resourceId: context._id,
    });
    assert.equal(access.allowed, true);
    assert.equal(String(access.resolvedSnapshotRef.resourceId), String(release._id));
  });
});

test("rimuovere una visita conserva la revisione e i diritti già acquisiti", { skip: !mongoUri }, async () => {
  await withFreshDatabase(async () => {
    const User = require("../models/user");
    const VisitV2 = require("../models/visitV2.model");
    const VisitRevisionV2 = require("../models/visitRevisionV2.model");
    const MarketplaceListing = require("../models/marketplaceListing.model");
    const MarketplaceOffer = require("../models/marketplaceOffer.model");
    const MarketplaceAcquisition = require("../models/marketplaceAcquisition.model");
    const Entitlement = require("../models/entitlement.model");
    const { Adoption } = require("../models/adoption.model");
    const marketplace = require("../services/marketplaceV2.service");
    const { removeOwnedWorkspaceResource } = require("../services/marketplaceResourceRemovalV2.service");
    const { listCreatorWorkspaceResources } = require("../services/marketplaceWorkspaceResourcesV2.service");
    const { resolveCapabilitySource } = require("../services/capabilityAuthorization.service");

    const [owner, buyer] = await users(User, "visit");
    const visit = await VisitV2.create({ ownerType: "user", ownerId: owner._id, createdBy: owner._id });
    const revision = await VisitRevisionV2.create({
      visitId: visit._id,
      version: 1,
      title: "Visita da eliminare",
      description: "Snapshot da conservare",
      status: "published",
      integrity: { status: "valid", issues: [], checkedAt: new Date(), checkedBy: owner._id },
      publication: { publishedAt: new Date(), publishedBy: owner._id },
      createdBy: owner._id,
      updatedBy: owner._id,
    });
    visit.publishedRevisionId = revision._id;
    await visit.save();
    const livePublication = await publishedListingWithOffer({
      MarketplaceListing, MarketplaceOffer, owner,
      resourceType: "visit", resourceId: visit._id, capability: "visit.execute", versionPolicy: "follow_current",
    });
    const snapshotPublication = await publishedListingWithOffer({
      MarketplaceListing, MarketplaceOffer, owner,
      resourceType: "visit_revision", resourceId: revision._id, capability: "visit.execute", versionPolicy: "pinned",
    });
    const acquired = await marketplace.acquireOffer({ offerId: livePublication.offer._id, actorUserId: buyer._id });
    const entitlement = acquired.entitlements[0];
    await Adoption.create({
      beneficiaryType: "user", beneficiaryId: buyer._id, entitlementId: entitlement._id,
      sourceResourceRef: { resourceType: "visit", resourceId: visit._id },
      sourceSnapshotRef: { resourceType: "visit_revision", resourceId: revision._id },
      action: "visit_copy", adoptedBy: buyer._id,
    });

    const result = await removeOwnedWorkspaceResource({ actorUserId: owner._id, resourceType: "visit", resourceId: visit._id });
    assert.equal(result.withdrawnListingCount, 2);
    assert.equal(result.inactiveOfferCount, 2);
    assert.equal((await VisitV2.findById(visit._id).lean()).lifecycleStatus, "trashed");
    assert.equal(await VisitRevisionV2.countDocuments({ _id: revision._id }), 1);
    assert.equal((await MarketplaceListing.findById(livePublication.listing._id).lean()).status, "withdrawn");
    assert.equal((await MarketplaceOffer.findById(livePublication.offer._id).lean()).status, "inactive");
    assert.equal((await MarketplaceListing.findById(snapshotPublication.listing._id).lean()).status, "withdrawn");
    assert.equal((await MarketplaceOffer.findById(snapshotPublication.offer._id).lean()).status, "inactive");
    assert.equal(await MarketplaceAcquisition.countDocuments({ _id: acquired.acquisition._id }), 1);
    assert.equal((await Entitlement.findById(entitlement._id).lean()).status, "active");
    assert.equal(await Adoption.countDocuments({ entitlementId: entitlement._id }), 1);

    await assertRemovedFromSales(owner, "removed visits and their snapshots must disappear from sales");

    const owned = await listCreatorWorkspaceResources({ actorUserId: owner._id, ownership: "owned", resourceTypes: ["visit"] });
    assert.equal(owned.total, 0);
    const licensed = await listCreatorWorkspaceResources({ actorUserId: buyer._id, ownership: "licensed" });
    assert.equal(licensed.results.length, 1);
    assert.equal(licensed.results[0].resourceType, "visit_revision");
    const access = await resolveCapabilitySource({
      actorUserId: buyer._id, capability: "visit.execute", resourceType: "visit", resourceId: visit._id,
    });
    assert.equal(access.allowed, true);
    assert.equal(String(access.resolvedSnapshotRef.resourceId), String(revision._id));
  });
});

test("rimuovere un PhysicalVocabulary preserva snapshot e fork già acquisito", { skip: !mongoUri }, async () => {
  await withFreshDatabase(async () => {
    const User = require("../models/user");
    const Organization = require("../models/organization.model");
    const PhysicalVocabulary = require("../models/physicalVocabulary.model");
    const PhysicalVocabularyRevision = require("../models/physicalVocabularyRevision.model");
    const Venue = require("../models/venue.model");
    const LayoutRevision = require("../models/layoutRevision.model");
    const VenueRelease = require("../models/venueRelease.model");
    const MarketplaceListing = require("../models/marketplaceListing.model");
    const MarketplaceOffer = require("../models/marketplaceOffer.model");
    const MarketplaceAcquisition = require("../models/marketplaceAcquisition.model");
    const Entitlement = require("../models/entitlement.model");
    const marketplace = require("../services/marketplaceV2.service");
    const physicalVocabularyService = require("../services/physicalVocabulary.service");
    const revisionService = require("../services/physicalVocabularyRevision.service");
    const { removeOwnedWorkspaceResource } = require("../services/marketplaceResourceRemovalV2.service");
    const { resolveCapabilitySource } = require("../services/capabilityAuthorization.service");
    const { computeVenueReleaseIssues } = require("../services/venueReleaseIntegrity.service");

    const [owner, buyer] = await users(User, "physical-vocabulary");
    const created = await physicalVocabularyService.createPhysicalVocabulary({
      actorUserId: owner._id,
      payload: {
        name: "Vocabolario fisico da rimuovere",
        ownerType: "user",
        ownerId: owner._id,
        applyStarter: true,
      },
    });
    await revisionService.evaluatePhysicalVocabulary({ physicalVocabularyId: created.physicalVocabulary._id, actorUserId: owner._id });
    const published = await revisionService.publishPhysicalVocabulary({ physicalVocabularyId: created.physicalVocabulary._id, actorUserId: owner._id });

    const livePublication = await publishedListingWithOffer({
      MarketplaceListing,
      MarketplaceOffer,
      owner,
      resourceType: "physical_vocabulary",
      resourceId: created.physicalVocabulary._id,
      capability: "physical_vocabulary.fork",
    });
    const snapshotPublication = await publishedListingWithOffer({
      MarketplaceListing,
      MarketplaceOffer,
      owner,
      resourceType: "physical_vocabulary_revision",
      resourceId: published.revision._id,
      capability: "physical_vocabulary.fork",
      versionPolicy: "pinned",
    });
    const acquired = await marketplace.acquireOffer({ offerId: livePublication.offer._id, actorUserId: buyer._id });
    const entitlement = acquired.entitlements[0];

    const result = await removeOwnedWorkspaceResource({
      actorUserId: owner._id,
      resourceType: "physical_vocabulary",
      resourceId: created.physicalVocabulary._id,
    });
    assert.equal(result.lifecycleStatus, "trashed");
    assert.equal(result.withdrawnListingCount, 2);
    assert.equal(result.inactiveOfferCount, 2);
    assert.equal((await PhysicalVocabulary.findById(created.physicalVocabulary._id).lean()).lifecycleStatus, "trashed");
    assert.equal(await PhysicalVocabularyRevision.countDocuments({ physicalVocabularyId: created.physicalVocabulary._id }), 1);
    assert.equal((await MarketplaceListing.findById(livePublication.listing._id).lean()).status, "withdrawn");
    assert.equal((await MarketplaceOffer.findById(livePublication.offer._id).lean()).status, "inactive");
    assert.equal((await MarketplaceListing.findById(snapshotPublication.listing._id).lean()).status, "withdrawn");
    assert.equal((await MarketplaceOffer.findById(snapshotPublication.offer._id).lean()).status, "inactive");
    assert.equal(await MarketplaceAcquisition.countDocuments({ _id: acquired.acquisition._id }), 1);
    assert.equal((await Entitlement.findById(entitlement._id).lean()).status, "active");
    await assertRemovedFromSales(owner, "removed physical vocabularies and snapshots must disappear from sales");

    const organization = await Organization.create({ name: "Owner dello snapshot fisico", createdBy: owner._id });
    const venue = await Venue.create({ name: "Venue con pin storico", ownerOrganizationId: organization._id, createdBy: owner._id });
    const layout = await LayoutRevision.create({
      venueId: venue._id,
      version: 1,
      authoredAgainstPhysicalVocabularyRevisionId: published.revision._id,
      status: "published",
      createdBy: owner._id,
      updatedBy: owner._id,
    });
    const venueRelease = await VenueRelease.create({
      venueId: venue._id,
      version: 1,
      layoutRevisionId: layout._id,
      status: "published",
      integrity: { status: "valid", issues: [], checkedAt: new Date(), checkedBy: owner._id },
      publication: { publishedAt: new Date(), publishedBy: owner._id },
      createdBy: owner._id,
      updatedBy: owner._id,
    });
    const pinnedIssues = await computeVenueReleaseIssues({ venue, release: venueRelease, layout });
    assert.equal(pinnedIssues.some((issue) => issue.code === "PHYSICAL_VOCABULARY_NOT_AVAILABLE"), false);

    const access = await resolveCapabilitySource({
      actorUserId: buyer._id,
      capability: "physical_vocabulary.fork",
      resourceType: "physical_vocabulary",
      resourceId: created.physicalVocabulary._id,
    });
    assert.equal(access.allowed, true);
    assert.equal(String(access.resolvedSnapshotRef.resourceId), String(published.revision._id));

    const forked = await physicalVocabularyService.forkPhysicalVocabulary({
      physicalVocabularyId: created.physicalVocabulary._id,
      actorUserId: buyer._id,
      payload: { ownerType: "user", ownerId: buyer._id, name: "Fork da snapshot acquisita" },
    });
    assert.equal(String(forked.physicalVocabulary.forkedFromPhysicalVocabularyRevisionId), String(published.revision._id));
    assert.equal(forked.revision.placeTypes.length, published.revision.placeTypes.length);
  });
});
