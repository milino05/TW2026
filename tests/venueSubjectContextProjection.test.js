const test = require("node:test");
const assert = require("node:assert/strict");
const mongoose = require("mongoose");
const { createPublishedPhysicalVocabulary } = require("./helpers/physicalVocabulary");
const { assignStarterRole } = require("./helpers/organizationRbac");

const mongoUri = process.env.MONGO_URI;
function oid() { return new mongoose.Types.ObjectId(); }
function id(value) { return String(value?._id || value || ""); }

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

async function addEdition({ ItemEdition, ItemRevisionV2, item, userId, published = false, working = false }) {
  const edition = await ItemEdition.create({ itemId: item._id, namespaceId: oid(), createdBy: userId });
  let publishedRevision = null;
  let workingRevision = null;
  if (published) {
    publishedRevision = await ItemRevisionV2.create({
      itemEditionId: edition._id,
      version: 1,
      authoredAgainstNamespaceRevisionId: oid(),
      label: `Pubblicato ${item._id}`,
      status: "published",
      integrity: { status: "valid", issues: [] },
      createdBy: userId,
      updatedBy: userId,
    });
    edition.publishedRevisionId = publishedRevision._id;
  }
  if (working) {
    workingRevision = await ItemRevisionV2.create({
      itemEditionId: edition._id,
      version: publishedRevision ? 2 : 1,
      basedOnRevisionId: publishedRevision?._id || null,
      authoredAgainstNamespaceRevisionId: oid(),
      label: `Bozza ${item._id}`,
      status: "draft",
      createdBy: userId,
      updatedBy: userId,
    });
    edition.workingRevisionId = workingRevision._id;
  }
  await edition.save();
  return { edition, publishedRevision, workingRevision };
}

async function buildFixture() {
  const User = require("../models/user");
  const Organization = require("../models/organization.model");
  const Subject = require("../models/subject.model");
  const Venue = require("../models/venue.model");
  const VenueTarget = require("../models/venueTarget.model");
  const ExhibitSlot = require("../models/exhibitSlot.model");
  const LayoutRevision = require("../models/layoutRevision.model");
  const VenueRelease = require("../models/venueRelease.model");
  const ItemV2 = require("../models/itemV2.model");
  const ItemEdition = require("../models/itemEdition.model");
  const ItemRevisionV2 = require("../models/itemRevisionV2.model");

  const user = await User.create({ username: `subject-context-${oid()}`, passwordHash: "hash" });
  const organization = await Organization.create({ name: "Museo projection", createdBy: user._id });
  await assignStarterRole({ organization, user, starterKey: "administrator" });
  const venue = await Venue.create({ name: "Sede projection", ownerOrganizationId: organization._id, createdBy: user._id });
  const [subjectExposed, subjectUnplaced, subjectUnavailable, subjectContentOnly, subjectOther] = await Subject.create([
    { preferredLabel: "Opera condivisa", createdBy: user._id },
    { preferredLabel: "Opera condivisa", createdBy: user._id },
    { preferredLabel: "Opera condivisa", createdBy: user._id },
    { preferredLabel: "Opera condivisa", createdBy: user._id },
    { preferredLabel: "Opera condivisa", createdBy: user._id },
  ]);
  const [targetExposed, targetUnplaced, targetUnavailable] = await VenueTarget.create([
    { venueId: venue._id, subjectId: subjectExposed._id, displayLabelOverride: "Opera esposta", createdBy: user._id },
    { venueId: venue._id, subjectId: subjectUnplaced._id, displayLabelOverride: "Opera da collocare", createdBy: user._id },
    { venueId: venue._id, subjectId: subjectUnavailable._id, displayLabelOverride: "Opera non disponibile", createdBy: user._id },
  ]);

  const physical = await createPublishedPhysicalVocabulary({ userId: user._id });
  const roomType = physical.placeTypeByKey.get("room");
  const floorId = oid();
  const roomId = oid();
  const [slotExposed, slotUnavailable] = await ExhibitSlot.create([
    { venueId: venue._id, createdBy: user._id },
    { venueId: venue._id, createdBy: user._id },
  ]);
  const layout = await LayoutRevision.create({
    venueId: venue._id,
    version: 1,
    authoredAgainstPhysicalVocabularyRevisionId: physical.revision._id,
    floors: [{ _id: floorId, label: "Piano terra" }],
    places: [{ _id: roomId, floorId, placeTypeDefinitionId: roomType.definitionId, label: "Sala 4", position: { x: 0.4, y: 0.5 } }],
    exhibitSlots: [
      { exhibitSlotId: slotExposed._id, placeId: roomId, label: "Parete destra · posizione 2", order: 2 },
      { exhibitSlotId: slotUnavailable._id, placeId: roomId, label: "Parete sinistra · posizione 1", order: 1 },
    ],
    connections: [],
    status: "published",
    createdBy: user._id,
    updatedBy: user._id,
  });
  const release = await VenueRelease.create({
    venueId: venue._id,
    version: 1,
    layoutRevisionId: layout._id,
    targetBindings: [
      { venueTargetId: targetExposed._id, exhibitSlotId: slotExposed._id, availability: "active", recognitionMedia: [] },
      { venueTargetId: targetUnavailable._id, exhibitSlotId: slotUnavailable._id, availability: "unavailable", recognitionMedia: [] },
    ],
    status: "published",
    integrity: { status: "valid", issues: [] },
    createdBy: user._id,
    updatedBy: user._id,
  });
  venue.publishedReleaseId = release._id;
  await venue.save();

  const itemAvailableMultiEdition = await ItemV2.create({
    primarySubjectId: subjectExposed._id,
    ownerType: "organization",
    ownerId: organization._id,
    createdBy: user._id,
  });
  await addEdition({ ItemEdition, ItemRevisionV2, item: itemAvailableMultiEdition, userId: user._id, published: true });
  await addEdition({ ItemEdition, ItemRevisionV2, item: itemAvailableMultiEdition, userId: user._id, published: true });

  const itemAvailableAndDraft = await ItemV2.create({
    primarySubjectId: subjectExposed._id,
    ownerType: "organization",
    ownerId: organization._id,
    createdBy: user._id,
  });
  await addEdition({ ItemEdition, ItemRevisionV2, item: itemAvailableAndDraft, userId: user._id, published: true, working: true });

  const itemDraftOnly = await ItemV2.create({
    primarySubjectId: subjectContentOnly._id,
    ownerType: "organization",
    ownerId: organization._id,
    createdBy: user._id,
  });
  await addEdition({ ItemEdition, ItemRevisionV2, item: itemDraftOnly, userId: user._id, working: true });

  const personalItem = await ItemV2.create({
    primarySubjectId: subjectExposed._id,
    ownerType: "user",
    ownerId: user._id,
    createdBy: user._id,
  });
  await addEdition({ ItemEdition, ItemRevisionV2, item: personalItem, userId: user._id, published: true, working: true });

  return {
    user,
    organization,
    venue,
    subjects: { subjectExposed, subjectUnplaced, subjectUnavailable, subjectContentOnly, subjectOther },
    targets: { targetExposed, targetUnplaced, targetUnavailable },
    slotExposed,
    roomId,
  };
}

test("shared Venue Subject projection derives inventory, position and museum-owned distinct Item counts", { skip: !mongoUri }, async () => {
  await withFreshDatabase(async () => {
    const fixture = await buildFixture();
    const { projectVenueSubjectContext, venueSubjectContextMap } = require("../services/venueSubjectContextProjection.service");
    const projection = await projectVenueSubjectContext({
      venueId: fixture.venue._id,
      subjectIds: Object.values(fixture.subjects).map((subject) => subject._id),
      view: "published",
    });
    const bySubjectId = venueSubjectContextMap(projection);

    assert.equal(projection.view, "published");
    const exposed = bySubjectId.get(id(fixture.subjects.subjectExposed._id));
    assert.equal(exposed.inventory.status, "exposed");
    assert.equal(id(exposed.inventory.venueTargetId), id(fixture.targets.targetExposed._id));
    assert.equal(id(exposed.inventory.slot.id), id(fixture.slotExposed._id));
    assert.equal(exposed.inventory.slot.label, "Parete destra · posizione 2");
    assert.equal(id(exposed.inventory.place.id), id(fixture.roomId));
    assert.equal(exposed.inventory.place.label, "Sala 4");
    assert.equal(exposed.inventory.place.floorLabel, "Piano terra");
    assert.deepEqual(exposed.museumContent, { availableCount: 2, draftCount: 1 });

    const unplaced = bySubjectId.get(id(fixture.subjects.subjectUnplaced._id));
    assert.equal(unplaced.inventory.status, "unplaced");
    assert.equal(unplaced.inventory.slot, null);
    assert.deepEqual(unplaced.museumContent, { availableCount: 0, draftCount: 0 });

    const unavailable = bySubjectId.get(id(fixture.subjects.subjectUnavailable._id));
    assert.equal(unavailable.inventory.status, "unavailable");
    assert.equal(unavailable.inventory.availability, "unavailable");
    assert.equal(unavailable.inventory.place.label, "Sala 4");

    const contentOnly = bySubjectId.get(id(fixture.subjects.subjectContentOnly._id));
    assert.equal(contentOnly.inventory, null);
    assert.deepEqual(contentOnly.museumContent, { availableCount: 0, draftCount: 1 });

    const other = bySubjectId.get(id(fixture.subjects.subjectOther._id));
    assert.equal(other.inventory, null);
    assert.deepEqual(other.museumContent, { availableCount: 0, draftCount: 0 });
  });
});

test("Venue-aware Subject resolver ranks from the shared projection and exposes only the nested context", { skip: !mongoUri }, async () => {
  await withFreshDatabase(async () => {
    const fixture = await buildFixture();
    const { searchVenueSubjectCandidates } = require("../services/venueSubjectResolver.service");
    const result = await searchVenueSubjectCandidates({
      venueId: fixture.venue._id,
      actorUserId: fixture.user._id,
      query: "Opera condivisa",
      limit: 20,
    });
    assert.equal(result.exact.length, 5);
    assert.deepEqual(result.exact.map((entry) => entry.source), [
      "venue_exposed",
      "venue_inventory",
      "venue_inventory",
      "organization_content",
      "artaround",
    ]);
    assert.equal(result.exact[0].inventory.status, "exposed");
    assert.equal(id(result.exact[0].inventory.venueTargetId), id(fixture.targets.targetExposed._id));
    assert.deepEqual(result.exact[0].museumContent, { availableCount: 2, draftCount: 1 });
    const contentOnly = result.exact.find((entry) => id(entry.id) === id(fixture.subjects.subjectContentOnly._id));
    assert.equal(contentOnly.inventory, null);
    assert.deepEqual(contentOnly.museumContent, { availableCount: 0, draftCount: 1 });
    assert.equal(Object.prototype.hasOwnProperty.call(result.exact[0], "state"), false);
    assert.equal(Object.prototype.hasOwnProperty.call(result.exact[0], "venueTargetId"), false);
  });
});
