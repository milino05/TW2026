const test = require("node:test");
const assert = require("node:assert/strict");
const mongoose = require("mongoose");
const { createPublishedPhysicalVocabulary } = require("./helpers/physicalVocabulary");

const mongoUri = process.env.MONGO_URI;
function oid() { return new mongoose.Types.ObjectId(); }

async function withFreshDatabase(callback) {
  await mongoose.connect(mongoUri, { serverSelectionTimeoutMS: 10000 });
  try {
    await mongoose.connection.dropDatabase();
    return await callback();
  } finally {
    await mongoose.connection.dropDatabase().catch(() => {});
    await mongoose.disconnect();
  }
}

async function addActiveOffer({ MarketplaceOffer, listing, userId }) {
  const policies = {
    item_edition: ["content.consume", "follow_current"],
    namespace: ["namespace.author", "follow_current"],
    visit: ["visit.execute", "follow_current"],
  };
  const [capability, versionPolicy] = policies[listing.resourceType];
  return MarketplaceOffer.create({
    listingId: listing._id,
    label: "Accesso disponibile",
    pricing: { type: "free" },
    grants: [{ resourceType: listing.resourceType, resourceId: listing.resourceId, capability, versionPolicy }],
    status: "active",
    createdBy: userId,
  });
}

async function createPublishedNamespace({ Namespace, NamespaceRevision, userId, name = "Namespace demo" }) {
  const namespace = await Namespace.create({ name, ownerType: "user", ownerId: userId, createdBy: userId });
  const revision = await NamespaceRevision.create({
    namespaceId: namespace._id,
    version: 1,
    durationTypes: [{ definitionId: "duration-short", key: "short", label: "Breve", targetSeconds: 60 }],
    languageLevels: [{ definitionId: "language-simple", key: "simple", label: "Semplice", complexity: 0.2 }],
    presentationAspects: [],
    selectionSignals: [],
    relationTypeDefinitions: [],
    status: "published",
    integrity: { status: "valid", issues: [], checkedAt: new Date(), checkedBy: userId },
    publication: { publishedAt: new Date(), publishedBy: userId },
    createdBy: userId,
    updatedBy: userId,
  });
  namespace.publishedRevisionId = revision._id;
  await namespace.save();
  return { namespace, revision };
}

async function createPublishedEdition({ ItemV2, ItemEdition, ItemRevisionV2, subjectId, namespaceId, namespaceRevisionId, userId, label, relatedSubjectIds = [] }) {
  const item = await ItemV2.create({ primarySubjectId: subjectId, ownerType: "user", ownerId: userId, createdBy: userId });
  const edition = await ItemEdition.create({ itemId: item._id, namespaceId, createdBy: userId });
  const revision = await ItemRevisionV2.create({
    itemEditionId: edition._id,
    version: 1,
    authoredAgainstNamespaceRevisionId: namespaceRevisionId,
    label,
    relatedSubjectIds,
    authorCredits: ["Autore"],
    metadata: { license: "CC BY" },
    presentationVariants: [],
    status: "published",
    integrity: { status: "valid", issues: [], checkedAt: new Date(), checkedBy: userId },
    publication: { publishedAt: new Date(), publishedBy: userId },
    createdBy: userId,
    updatedBy: userId,
  });
  edition.publishedRevisionId = revision._id;
  await edition.save();
  return { item, edition, revision };
}

async function publishVenueTargets({ VenueRelease, venue, targetIds, userId }) {
  const ExhibitSlot = require("../models/exhibitSlot.model");
  const LayoutRevision = require("../models/layoutRevision.model");
  const physical = await createPublishedPhysicalVocabulary({ userId });
  const roomType = physical.placeTypeByKey.get("room");
  const floorId = oid();
  const roomId = oid();
  const slots = [];
  for (let index = 0; index < targetIds.length; index += 1) {
    slots.push(await ExhibitSlot.create({ venueId: venue._id, createdBy: userId }));
  }
  const layout = await LayoutRevision.create({
    venueId: venue._id,
    version: 1,
    authoredAgainstPhysicalVocabularyRevisionId: physical.revision._id,
    floors: [{ _id: floorId, label: "Piano terra" }],
    places: [{ _id: roomId, floorId, placeTypeDefinitionId: roomType.definitionId, label: "Sala test", position: { x: 0.5, y: 0.5 } }],
    exhibitSlots: slots.map((slot, index) => ({ exhibitSlotId: slot._id, placeId: roomId, label: `Posizione ${index + 1}`, order: index })),
    connections: [],
    status: "published",
    createdBy: userId,
    updatedBy: userId,
  });
  const release = await VenueRelease.create({
    venueId: venue._id,
    version: 1,
    layoutRevisionId: layout._id,
    targetBindings: targetIds.map((targetId, index) => ({
      venueTargetId: targetId,
      exhibitSlotId: slots[index]._id,
      availability: "active",
      recognitionMedia: [{ url: `https://example.test/${targetId}.jpg`, altText: "Riconoscimento" }],
    })),
    status: "published",
    integrity: { status: "valid", issues: [], checkedAt: new Date(), checkedBy: userId },
    publication: { publishedAt: new Date(), publishedBy: userId },
    createdBy: userId,
    updatedBy: userId,
  });
  venue.publishedReleaseId = release._id;
  await venue.save();
  return release;
}

test("Subject exact external identity is searchable and unique at database level", { skip: !mongoUri }, async () => {
  await withFreshDatabase(async () => {
    const User = require("../models/user");
    const Subject = require("../models/subject.model");
    const { listSubjects } = require("../services/subject.service");
    const user = await User.create({ username: "subject-author", passwordHash: "hash" });
    await Subject.syncIndexes();
    const identity = {
      scheme: "wikidata", id: "Q40415", role: "canonical",
      confirmation: { source: "seed", confirmedAt: new Date(), confirmedBy: user._id },
      verification: { status: "verified", checkedAt: new Date() },
    };
    const subject = await Subject.create({
      preferredLabel: "Impressionismo", externalIdentities: [identity], createdBy: user._id,
    });
    const found = await listSubjects({ externalScheme: "wikidata", externalId: "Q40415" });
    assert.equal(found.length, 1);
    assert.equal(String(found[0]._id), String(subject._id));
    await assert.rejects(
      () => Subject.create({ preferredLabel: "Duplicato", externalIdentities: [identity], createdBy: user._id }),
      (error) => error?.code === 11000,
    );
  });
});

test("Venue selector is grouped by Organization and does not expose editorial/physical internals", { skip: !mongoUri }, async () => {
  await withFreshDatabase(async () => {
    const User = require("../models/user");
    const Organization = require("../models/organization.model");
    const Venue = require("../models/venue.model");
    const { resolveVenueSelectorProjection } = require("../services/venueCatalogRelevanceV2.service");
    const user = await User.create({ username: "venue-selector", passwordHash: "hash" });
    const organization = await Organization.create({ name: "Musei civici", createdBy: user._id });
    await Venue.create({ name: "Sede A", ownerOrganizationId: organization._id, primaryEditorialContextId: oid(), createdBy: user._id });
    const projection = await resolveVenueSelectorProjection();
    assert.equal(projection.organizations.length, 1);
    assert.equal(projection.organizations[0].venues.length, 1);
    const venue = projection.organizations[0].venues[0];
    assert.equal(venue.name, "Sede A");
    assert.equal(venue.primaryEditorialContextId, undefined);
    assert.equal(venue.publishedReleaseId, undefined);
    assert.equal(venue.ownerOrganizationId, undefined);
  });
});

test("multi-Venue Catalog uses union relevance, keeps Namespace venue-neutral and exposes full Visit PhysicalScope", { skip: !mongoUri }, async () => {
  await withFreshDatabase(async () => {
    const User = require("../models/user");
    const Organization = require("../models/organization.model");
    const Subject = require("../models/subject.model");
    const Venue = require("../models/venue.model");
    const VenueTarget = require("../models/venueTarget.model");
    const VenueRelease = require("../models/venueRelease.model");
    const Namespace = require("../models/namespace.model");
    const NamespaceRevision = require("../models/namespaceRevision.model");
    const ItemV2 = require("../models/itemV2.model");
    const ItemEdition = require("../models/itemEdition.model");
    const ItemRevisionV2 = require("../models/itemRevisionV2.model");
    const VisitV2 = require("../models/visitV2.model");
    const VisitRevisionV2 = require("../models/visitRevisionV2.model");
    const MarketplaceListing = require("../models/marketplaceListing.model");
    const MarketplaceOffer = require("../models/marketplaceOffer.model");
    const { listCatalog } = require("../services/marketplaceCatalogV2.service");

    const user = await User.create({ username: "catalog-author", passwordHash: "hash" });
    const organization = await Organization.create({ name: "Rete museale", createdBy: user._id });
    const [subjectA, subjectB, subjectC] = await Subject.create([
      { preferredLabel: "Opera A", createdBy: user._id },
      { preferredLabel: "Opera B", createdBy: user._id },
      { preferredLabel: "Tema C", createdBy: user._id },
    ]);
    const [venueA, venueB] = await Venue.create([
      { name: "Museo A", ownerOrganizationId: organization._id, createdBy: user._id },
      { name: "Museo B", ownerOrganizationId: organization._id, createdBy: user._id },
    ]);
    const [targetA, targetB] = await VenueTarget.create([
      { venueId: venueA._id, subjectId: subjectA._id, displayLabelOverride: "Oggetto A", createdBy: user._id },
      { venueId: venueB._id, subjectId: subjectB._id, displayLabelOverride: "Oggetto B", createdBy: user._id },
    ]);
    await publishVenueTargets({ VenueRelease, venue: venueA, targetIds: [targetA._id], userId: user._id });
    await publishVenueTargets({ VenueRelease, venue: venueB, targetIds: [targetB._id], userId: user._id });

    const { namespace, revision: namespaceRevision } = await createPublishedNamespace({ Namespace, NamespaceRevision, userId: user._id });
    const contentA = await createPublishedEdition({ ItemV2, ItemEdition, ItemRevisionV2, subjectId: subjectA._id, namespaceId: namespace._id, namespaceRevisionId: namespaceRevision._id, userId: user._id, label: "Contenuto A" });
    const contentB = await createPublishedEdition({ ItemV2, ItemEdition, ItemRevisionV2, subjectId: subjectB._id, namespaceId: namespace._id, namespaceRevisionId: namespaceRevision._id, userId: user._id, label: "Contenuto B" });
    const contentRelatedA = await createPublishedEdition({ ItemV2, ItemEdition, ItemRevisionV2, subjectId: subjectC._id, namespaceId: namespace._id, namespaceRevisionId: namespaceRevision._id, userId: user._id, label: "Approfondimento correlato ad A", relatedSubjectIds: [subjectA._id] });

    const visit = await VisitV2.create({ ownerType: "user", ownerId: user._id, createdBy: user._id });
    const visitRevision = await VisitRevisionV2.create({
      visitId: visit._id,
      version: 1,
      title: "Visita A+B",
      editorialSources: [],
      contentEntries: [],
      visitAnchors: [
        { venueTargetId: targetA._id, estimatedObservationSeconds: 0 },
        { venueTargetId: targetB._id, estimatedObservationSeconds: 0 },
      ],
      status: "published",
      integrity: { status: "valid", issues: [], checkedAt: new Date(), checkedBy: user._id },
      publication: { publishedAt: new Date(), publishedBy: user._id },
      createdBy: user._id,
      updatedBy: user._id,
    });
    visit.publishedRevisionId = visitRevision._id;
    await visit.save();

    const resources = [
      ["item_edition", contentA.edition._id, "Contenuto A"],
      ["item_edition", contentB.edition._id, "Contenuto B"],
      ["item_edition", contentRelatedA.edition._id, "Approfondimento correlato ad A"],
      ["namespace", namespace._id, "namespace"],
      ["visit", visit._id, "visit"],
    ];
    for (const [resourceType, resourceId, title] of resources) {
      const listing = await MarketplaceListing.create({ sellerType: "user", sellerId: user._id, resourceType, resourceId, title, status: "published", createdBy: user._id });
      await addActiveOffer({ MarketplaceOffer, listing, userId: user._id });
    }

    const aOnly = await listCatalog({ actorUserId: user._id, selectedVenueIds: [venueA._id], resourceTypes: ["item_edition"] });
    assert.deepEqual(new Set(aOnly.results.map((entry) => entry.asset.title)), new Set(["Contenuto A", "Approfondimento correlato ad A"]));

    const both = await listCatalog({ actorUserId: user._id, selectedVenueIds: [venueA._id, venueB._id], resourceTypes: ["item_edition"] });
    assert.deepEqual(new Set(both.results.map((entry) => entry.asset.title)), new Set(["Contenuto A", "Contenuto B", "Approfondimento correlato ad A"]));

    const namespaceCatalog = await listCatalog({ actorUserId: user._id, selectedVenueIds: [venueA._id], resourceTypes: ["namespace"] });
    assert.equal(namespaceCatalog.results.length, 1);
    assert.equal(namespaceCatalog.results[0].asset.venueRelevance.venueNeutral, true);

    const visitCatalog = await listCatalog({ actorUserId: user._id, selectedVenueIds: [venueA._id], resourceTypes: ["visit"] });
    assert.equal(visitCatalog.results.length, 1);
    assert.deepEqual(new Set(visitCatalog.results[0].asset.physicalScope.map((venue) => venue.name)), new Set(["Museo A", "Museo B"]));
  });
});

test("unpublished VenueTarget does not make editorial content Venue-relevant, but Visit PhysicalScope still derives from VenueTarget identity", { skip: !mongoUri }, async () => {
  await withFreshDatabase(async () => {
    const User = require("../models/user");
    const Organization = require("../models/organization.model");
    const Subject = require("../models/subject.model");
    const Venue = require("../models/venue.model");
    const VenueTarget = require("../models/venueTarget.model");
    const Namespace = require("../models/namespace.model");
    const NamespaceRevision = require("../models/namespaceRevision.model");
    const ItemV2 = require("../models/itemV2.model");
    const ItemEdition = require("../models/itemEdition.model");
    const ItemRevisionV2 = require("../models/itemRevisionV2.model");
    const VisitV2 = require("../models/visitV2.model");
    const VisitRevisionV2 = require("../models/visitRevisionV2.model");
    const MarketplaceListing = require("../models/marketplaceListing.model");
    const MarketplaceOffer = require("../models/marketplaceOffer.model");
    const { listCatalog } = require("../services/marketplaceCatalogV2.service");

    const user = await User.create({ username: "draft-target", passwordHash: "hash" });
    const organization = await Organization.create({ name: "Org", createdBy: user._id });
    const subject = await Subject.create({ preferredLabel: "Non ancora pubblicato", createdBy: user._id });
    const venue = await Venue.create({ name: "Venue draft", ownerOrganizationId: organization._id, createdBy: user._id });
    const target = await VenueTarget.create({ venueId: venue._id, subjectId: subject._id, displayLabelOverride: "Target draft", createdBy: user._id });
    const { namespace, revision: namespaceRevision } = await createPublishedNamespace({ Namespace, NamespaceRevision, userId: user._id });
    const content = await createPublishedEdition({ ItemV2, ItemEdition, ItemRevisionV2, subjectId: subject._id, namespaceId: namespace._id, namespaceRevisionId: namespaceRevision._id, userId: user._id, label: "Contenuto draft-target" });
    const visit = await VisitV2.create({ ownerType: "user", ownerId: user._id, createdBy: user._id });
    const revision = await VisitRevisionV2.create({ visitId: visit._id, version: 1, title: "Visit draft target", visitAnchors: [{ venueTargetId: target._id }], status: "published", createdBy: user._id, updatedBy: user._id });
    visit.publishedRevisionId = revision._id; await visit.save();
    const itemListing = await MarketplaceListing.create({ sellerType: "user", sellerId: user._id, resourceType: "item_edition", resourceId: content.edition._id, status: "published", createdBy: user._id });
    const visitListing = await MarketplaceListing.create({ sellerType: "user", sellerId: user._id, resourceType: "visit", resourceId: visit._id, status: "published", createdBy: user._id });
    await addActiveOffer({ MarketplaceOffer, listing: itemListing, userId: user._id });
    await addActiveOffer({ MarketplaceOffer, listing: visitListing, userId: user._id });

    const itemCatalog = await listCatalog({ actorUserId: user._id, selectedVenueIds: [venue._id], resourceTypes: ["item_edition"] });
    assert.equal(itemCatalog.results.length, 0);
    const visitCatalog = await listCatalog({ actorUserId: user._id, selectedVenueIds: [venue._id], resourceTypes: ["visit"] });
    assert.equal(visitCatalog.results.length, 1);
  });
});

test("VenueTarget authoring context keeps recognition media physical and separate from Item illustrative media", { skip: !mongoUri }, async () => {
  await withFreshDatabase(async () => {
    const User = require("../models/user");
    const Organization = require("../models/organization.model");
    const Subject = require("../models/subject.model");
    const Venue = require("../models/venue.model");
    const VenueTarget = require("../models/venueTarget.model");
    const VenueRelease = require("../models/venueRelease.model");
    const { getVenueTargetAuthoringContext } = require("../services/itemAuthoringV2.service");
    const user = await User.create({ username: "media-boundary", passwordHash: "hash" });
    const organization = await Organization.create({ name: "Media org", createdBy: user._id });
    const subject = await Subject.create({ preferredLabel: "Oggetto", createdBy: user._id });
    const venue = await Venue.create({ name: "Media Venue", ownerOrganizationId: organization._id, createdBy: user._id });
    const target = await VenueTarget.create({ venueId: venue._id, subjectId: subject._id, displayLabelOverride: "Oggetto fisico", createdBy: user._id });
    await publishVenueTargets({ VenueRelease, venue, targetIds: [target._id], userId: user._id });
    const context = await getVenueTargetAuthoringContext({ venueTargetId: target._id });
    assert.equal(context.subject.preferredLabel, "Oggetto");
    assert.equal(context.recognitionMedia.length, 1);
    assert.equal(context.illustrativeMedia, undefined);
    assert.equal(context.venueTarget.subjectId, undefined);
    assert.equal(context.venueTarget.inventoryState, "exposed");
    assert.equal(context.venueTarget.inventory.status, "exposed");
    assert.equal(context.venueTarget.inventory.place.label, "Sala test");
    assert.deepEqual(context.venueTarget.museumContent, { availableCount: 0, draftCount: 0 });
  });
});

test("Item physical intent atomically creates or reuses the Venue inventory entity", { skip: !mongoUri }, async () => {
  await withFreshDatabase(async () => {
    const User = require("../models/user");
    const Subject = require("../models/subject.model");
    const Venue = require("../models/venue.model");
    const VenueTarget = require("../models/venueTarget.model");
    const ItemV2 = require("../models/itemV2.model");
    const organizationService = require("../services/organization.service");
    const { createItemWithPhysicalIntent } = require("../services/itemV2.service");
    const { searchVenueSubjectCandidates } = require("../services/venueSubjectResolver.service");

    const user = await User.create({ username: "physical-intent-author", passwordHash: "hash" });
    const organization = await organizationService.createOrganization({ payload: { name: "Physical intent org" }, actorUserId: user._id });
    const subject = await Subject.create({ preferredLabel: "Opera da collocare", createdBy: user._id });
    const venue = await Venue.create({ name: "Physical intent Venue", ownerOrganizationId: organization._id, createdBy: user._id });
    const payload = { primarySubjectId: subject._id, ownerType: "organization", ownerId: organization._id };

    const first = await createItemWithPhysicalIntent({ venueId: venue._id, payload, actorUserId: user._id });
    assert.equal(first.createdVenueEntity, true);
    assert.equal(String(first.venueEntity.subjectId), String(subject._id));
    assert.equal(first.venueEntity.provenance.origin, "item_authoring");

    const second = await createItemWithPhysicalIntent({ venueId: venue._id, payload, actorUserId: user._id });
    assert.equal(second.createdVenueEntity, false);
    assert.equal(String(second.venueEntity._id), String(first.venueEntity._id));
    assert.equal(await ItemV2.countDocuments({ primarySubjectId: subject._id }), 2);
    assert.equal(await VenueTarget.countDocuments({ venueId: venue._id, subjectId: subject._id, lifecycleStatus: "active" }), 1);

    const candidates = await searchVenueSubjectCandidates({
      venueId: venue._id,
      actorUserId: user._id,
      query: "Opera da collocare",
    });
    assert.equal(String(candidates.venue.id), String(venue._id));
    assert.equal(candidates.venue.name, "Physical intent Venue");
    assert.equal(String(candidates.venue.ownerOrganizationId), String(organization._id));
    assert.equal(candidates.permissions.canEditInventory, true);
    assert.equal(String(candidates.exact[0].inventory.venueTargetId), String(first.venueEntity._id));
    assert.equal(candidates.exact[0].inventory.status, "unplaced");
    assert.equal(candidates.exact[0].venueTargetId, undefined);
    assert.equal(candidates.exact[0].state, undefined);

    await assert.rejects(
      () => createItemWithPhysicalIntent({ venueId: venue._id, payload: { ...payload, primarySubjectId: oid() }, actorUserId: user._id }),
      (error) => error?.status === 404,
    );
    assert.equal(await ItemV2.countDocuments({ ownerId: organization._id }), 2);

    await assert.rejects(
      () => createItemWithPhysicalIntent({
        venueId: venue._id,
        payload: { primarySubjectId: subject._id, ownerType: "user", ownerId: user._id },
        actorUserId: user._id,
      }),
      (error) => error?.status === 409 && error?.details?.some((detail) => detail.code === "PHYSICAL_INTENT_OWNER_MISMATCH"),
    );
  });
});
