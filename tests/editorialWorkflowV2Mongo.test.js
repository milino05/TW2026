const test = require("node:test");
const assert = require("node:assert/strict");
const mongoose = require("mongoose");
const { assignStarterRole } = require("./helpers/organizationRbac");

const baseMongoUri = process.env.MONGO_URI;
function isolatedMongoUri(uri) {
  if (!uri) return null;
  const parsed = new URL(uri);
  const dbName = parsed.pathname.replace(/^\/+/, "") || "artaround_test";
  parsed.pathname = `/${dbName}_editorial_workflow_v2`;
  return parsed.toString();
}
const mongoUri = isolatedMongoUri(baseMongoUri);
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

async function createContentFixture({ manager, organization }) {
  const Subject = require("../models/subject.model");
  const ItemV2 = require("../models/itemV2.model");
  const ItemEdition = require("../models/itemEdition.model");
  const ItemRevisionV2 = require("../models/itemRevisionV2.model");
  const Venue = require("../models/venue.model");
  const VenueTarget = require("../models/venueTarget.model");
  const LayoutRevision = require("../models/layoutRevision.model");
  const VenueRelease = require("../models/venueRelease.model");

  const subject = await Subject.create({ preferredLabel: "Opera workflow", createdBy: manager._id });
  const item = await ItemV2.create({ primarySubjectId: subject._id, ownerType: "user", ownerId: manager._id, createdBy: manager._id });
  const edition = await ItemEdition.create({ itemId: item._id, namespaceId: oid(), createdBy: manager._id });
  const itemRevision = await ItemRevisionV2.create({
    itemEditionId: edition._id,
    version: 1,
    authoredAgainstNamespaceRevisionId: oid(),
    label: "Descrizione workflow",
    authorCredits: ["Autore"],
    metadata: { license: "CC BY" },
    presentationVariants: [],
    status: "published",
    integrity: { status: "valid", issues: [], checkedAt: new Date(), checkedBy: manager._id },
    publication: { publishedAt: new Date(), publishedBy: manager._id },
    createdBy: manager._id,
    updatedBy: manager._id,
  });
  edition.publishedRevisionId = itemRevision._id;
  await edition.save();

  const venue = await Venue.create({ name: "Venue workflow", ownerOrganizationId: organization._id, createdBy: manager._id });
  const target = await VenueTarget.create({ venueId: venue._id, subjectId: subject._id, label: "Opera in sala", createdBy: manager._id });
  const layout = await LayoutRevision.create({ venueId: venue._id, version: 1, status: "published", createdBy: manager._id, updatedBy: manager._id });
  const venueRelease = await VenueRelease.create({
    venueId: venue._id,
    version: 1,
    layoutRevisionId: layout._id,
    targetBindings: [{ venueTargetId: target._id, availability: "active", recognitionMedia: [] }],
    status: "published",
    integrity: { status: "valid", issues: [], checkedAt: new Date(), checkedBy: manager._id },
    publication: { publishedAt: new Date(), publishedBy: manager._id },
    createdBy: manager._id,
    updatedBy: manager._id,
  });
  venue.publishedReleaseId = venueRelease._id;
  await venue.save();
  return { item, edition, itemRevision, target };
}

async function createEditorialSource({ ownerType, ownerId, createdBy, edition, itemRevision }) {
  const ContentSpace = require("../models/contentSpace.model");
  const EditorialContext = require("../models/editorialContext.model");
  const EditorialRelease = require("../models/editorialRelease.model");
  const space = await ContentSpace.create({
    name: `${ownerType}-workflow-space`,
    ownerType,
    ownerId,
    createdBy,
  });
  const context = await EditorialContext.create({
    contentSpaceId: space._id,
    namespaceId: oid(),
    displayName: `${ownerType} workflow context`,
    createdBy,
  });
  const release = await EditorialRelease.create({
    editorialContextId: context._id,
    version: 1,
    namespaceRevisionId: oid(),
    graphRevisionId: oid(),
    itemBindings: [{ itemEditionId: edition._id, itemRevisionId: itemRevision._id, curationSignals: [] }],
    integrity: { status: "valid", issues: [], checkedAt: new Date(), checkedBy: createdBy },
    releasedAt: new Date(),
    releasedBy: createdBy,
  });
  context.publishedReleaseId = release._id;
  await context.save();
  return release;
}

function visitPayload({ ownerType, ownerId, release, fixture, title }) {
  const editorialSourceId = oid();
  const anchorId = oid();
  return {
    ownerType,
    ownerId,
    title,
    editorialSources: [{ _id: editorialSourceId, editorialReleaseId: release._id }],
    visitAnchors: [{ _id: anchorId, venueTargetId: fixture.target._id }],
    contentEntries: [{
      editorialSourceId,
      itemId: fixture.item._id,
      itemEditionId: fixture.edition._id,
      itemRevisionId: fixture.itemRevision._id,
      deliveryAnchorId: anchorId,
      role: "core",
    }],
    logistics: { preVisitNotes: [], routeHints: [] },
  };
}

test("Visit publication distingue ownership personale e review Organization", { skip: !mongoUri }, async () => {
  await withFreshDatabase(async () => {
    const User = require("../models/user");
    const Organization = require("../models/organization.model");
    const { createVisitV2 } = require("../services/visitV2.service");
    const {
      evaluateVisitV2Consistency,
      requestVisitV2Review,
      publishVisitV2,
    } = require("../services/visitV2Publication.service");

    const manager = await User.create({ username: "workflow-manager", passwordHash: "hash" });
    const organization = await Organization.create({ name: "Workflow organization", createdBy: manager._id });
    await assignStarterRole({ organization, user: manager, starterKey: "administrator" });
    const operator = await User.create({ username: "workflow-operator", passwordHash: "hash" });
    await assignStarterRole({ organization, user: operator, starterKey: "contributor", actorUserId: manager._id });

    const fixture = await createContentFixture({ manager, organization });
    const personalRelease = await createEditorialSource({
      ownerType: "user",
      ownerId: manager._id,
      createdBy: manager._id,
      edition: fixture.edition,
      itemRevision: fixture.itemRevision,
    });
    const organizationRelease = await createEditorialSource({
      ownerType: "organization",
      ownerId: organization._id,
      createdBy: manager._id,
      edition: fixture.edition,
      itemRevision: fixture.itemRevision,
    });

    const personal = await createVisitV2({
      actorUserId: manager._id,
      payload: visitPayload({
        ownerType: "user",
        ownerId: manager._id,
        release: personalRelease,
        fixture,
        title: "Visita personale",
      }),
    });
    await evaluateVisitV2Consistency({ visitId: personal.visit._id, actorUserId: manager._id });
    const personalPublished = await publishVisitV2({ visitId: personal.visit._id, actorUserId: manager._id });
    assert.equal(personalPublished.revision.status, "published");
    assert.equal(personalPublished.revision.review.decision, null);
    assert.equal(personalPublished.revision.review.events.length, 0);

    const organizationVisit = await createVisitV2({
      actorUserId: operator._id,
      payload: visitPayload({
        ownerType: "organization",
        ownerId: organization._id,
        release: organizationRelease,
        fixture,
        title: "Visita Organization",
      }),
    });
    await evaluateVisitV2Consistency({ visitId: organizationVisit.visit._id, actorUserId: operator._id });

    await assert.rejects(
      () => publishVisitV2({ visitId: organizationVisit.visit._id, actorUserId: manager._id }),
      (error) => error?.status === 409 && error?.details?.some?.((entry) => entry.code === "INVALID_APPROVAL_PUBLISH_TRANSITION"),
    );

    const reviewed = await requestVisitV2Review({ visitId: organizationVisit.visit._id, actorUserId: operator._id });
    assert.equal(reviewed.revision.status, "in_review");

    await assert.rejects(
      () => publishVisitV2({ visitId: organizationVisit.visit._id, actorUserId: operator._id }),
      (error) => error?.status === 403,
    );

    const organizationPublished = await publishVisitV2({ visitId: organizationVisit.visit._id, actorUserId: manager._id });
    assert.equal(organizationPublished.revision.status, "published");
    assert.equal(organizationPublished.revision.review.decision, "approved");
    assert.equal(String(organizationPublished.revision.review.reviewedBy), String(manager._id));
  });
});
