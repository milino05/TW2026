const fs = require("fs");
const path = require("path");
const test = require("node:test");
const assert = require("node:assert/strict");
const mongoose = require("mongoose");
const { createPublishedPhysicalVocabulary } = require("./helpers/physicalVocabulary");

const baseMongoUri = process.env.MONGO_URI;
function isolatedMongoUri(uri) {
  if (!uri) return null;
  const parsed = new URL(uri);
  const dbName = parsed.pathname.replace(/^\/+/, "") || "artaround_test";
  parsed.pathname = `/${dbName}_visit_v2`;
  return parsed.toString();
}
const mongoUri = isolatedMongoUri(baseMongoUri);

function loadAllModels() {
  const modelsDir = path.join(__dirname, "..", "models");
  for (const file of fs.readdirSync(modelsDir)) if (file.endsWith(".js")) require(path.join(modelsDir, file));
}

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

test("Visit v2 pins editorial content, references VenueTarget and copies detached", { skip: !mongoUri }, async () => {
  await withFreshDatabase(async () => {
    loadAllModels();
    const User = require("../models/user");
    const Organization = require("../models/organization.model");
    const Subject = require("../models/subject.model");
    const ItemV2 = require("../models/itemV2.model");
    const ItemEdition = require("../models/itemEdition.model");
    const ItemRevisionV2 = require("../models/itemRevisionV2.model");
    const ContentSpace = require("../models/contentSpace.model");
    const EditorialContext = require("../models/editorialContext.model");
    const EditorialRelease = require("../models/editorialRelease.model");
    const Venue = require("../models/venue.model");
    const VenueTarget = require("../models/venueTarget.model");
    const LayoutRevision = require("../models/layoutRevision.model");
    const VenueRelease = require("../models/venueRelease.model");
    const VisitRevisionV2 = require("../models/visitRevisionV2.model");
    const { createVisitV2, updateVisitV2, copyVisitV2 } = require("../services/visitV2.service");
    const { evaluateVisitV2Consistency, publishVisitV2 } = require("../services/visitV2Publication.service");
    const { auditVisitsAgainstVenueRelease } = require("../services/visitV2Dependency.service");

    const user = await User.create({ username: "visit-v2-test", passwordHash: "test-hash" });
    const organization = await Organization.create({ name: "Venue owner", createdBy: user._id });
    const subject = await Subject.create({ preferredLabel: "Opera", createdBy: user._id });

    const item = await ItemV2.create({ primarySubjectId: subject._id, ownerType: "user", ownerId: user._id, createdBy: user._id });
    const edition = await ItemEdition.create({ itemId: item._id, namespaceId: new mongoose.Types.ObjectId(), createdBy: user._id });
    const itemRevision = await ItemRevisionV2.create({
      itemEditionId: edition._id,
      version: 1,
      authoredAgainstNamespaceRevisionId: new mongoose.Types.ObjectId(),
      label: "Descrizione pubblicata",
      authorCredits: ["Autore"],
      metadata: { license: "CC BY" },
      presentationVariants: [],
      status: "published",
      integrity: { status: "valid", issues: [], checkedAt: new Date(), checkedBy: user._id },
      publication: { publishedAt: new Date(), publishedBy: user._id },
      createdBy: user._id,
      updatedBy: user._id,
    });
    edition.publishedRevisionId = itemRevision._id;
    await edition.save();

    const contentSpace = await ContentSpace.create({ name: "Spazio visita", ownerType: "user", ownerId: user._id, createdBy: user._id });
    const editorialContext = await EditorialContext.create({
      contentSpaceId: contentSpace._id,
      namespaceId: new mongoose.Types.ObjectId(),
      displayName: "Contesto visita",
      createdBy: user._id,
    });
    const editorialRelease = await EditorialRelease.create({
      editorialContextId: editorialContext._id,
      version: 1,
      namespaceRevisionId: new mongoose.Types.ObjectId(),
      graphRevisionId: new mongoose.Types.ObjectId(),
      itemBindings: [{ itemEditionId: edition._id, itemRevisionId: itemRevision._id, curationSignals: [] }],
      integrity: { status: "valid", issues: [], checkedAt: new Date(), checkedBy: user._id },
      releasedAt: new Date(),
      releasedBy: user._id,
    });
    editorialContext.publishedReleaseId = editorialRelease._id;
    await editorialContext.save();

    const venue = await Venue.create({ name: "Venue", ownerOrganizationId: organization._id, createdBy: user._id });
    const ExhibitSlot = require("../models/exhibitSlot.model");
    const target = await VenueTarget.create({ venueId: venue._id, subjectId: subject._id, displayLabelOverride: "Opera in sala", createdBy: user._id });
    const slot = await ExhibitSlot.create({ venueId: venue._id, createdBy: user._id });
    const physical = await createPublishedPhysicalVocabulary({ userId: user._id });
    const floorId = new mongoose.Types.ObjectId();
    const placeId = new mongoose.Types.ObjectId();
    const layout = await LayoutRevision.create({
      venueId: venue._id,
      version: 1,
      authoredAgainstPhysicalVocabularyRevisionId: physical.revision._id,
      floors: [{ _id: floorId, label: "Piano terra" }],
      places: [{ _id: placeId, floorId, placeTypeDefinitionId: physical.placeTypeByKey.get("room").definitionId, label: "Sala", position: { x: 0.5, y: 0.5 }, attributeValues: [] }],
      exhibitSlots: [{ exhibitSlotId: slot._id, placeId, label: "Slot opera" }],
      status: "published",
      createdBy: user._id,
      updatedBy: user._id,
    });
    const venueRelease = await VenueRelease.create({
      venueId: venue._id,
      version: 1,
      layoutRevisionId: layout._id,
      targetBindings: [{ venueTargetId: target._id, exhibitSlotId: slot._id, availability: "active", recognitionMedia: [] }],
      status: "published",
      integrity: { status: "valid", issues: [], checkedAt: new Date(), checkedBy: user._id },
      publication: { publishedAt: new Date(), publishedBy: user._id },
      createdBy: user._id,
      updatedBy: user._id,
    });
    venue.publishedReleaseId = venueRelease._id;
    await venue.save();

    const editorialSourceId = new mongoose.Types.ObjectId();
    const anchorId = new mongoose.Types.ObjectId();
    const created = await createVisitV2({
      actorUserId: user._id,
      payload: {
        ownerType: "user",
        ownerId: user._id,
        title: "Visita originale",
        deliveryMode: "synchronized",
        synchronization: { joinAlias: "Fenice rossa" },
        quiz: { questions: [{ question: "Chi è l'autore?", options: ["Autore", "Altro"], correctOptionIndex: 0, points: 2 }] },
        editorialSources: [{ _id: editorialSourceId, editorialReleaseId: editorialRelease._id }],
        visitAnchors: [{ _id: anchorId, venueTargetId: target._id }],
        contentEntries: [{ editorialSourceId, itemId: item._id, itemEditionId: edition._id, itemRevisionId: itemRevision._id, deliveryAnchorId: anchorId, role: "core" }],
        presentationBaseline: { depthPreference: 0.5, languageComplexityPreference: 0.5, locale: "it-IT" },
        logistics: { preVisitNotes: ["Ingresso principale"], routeHints: [] },
      },
    });

    const checked = await evaluateVisitV2Consistency({ visitId: created.visit._id, actorUserId: user._id });
    assert.equal(checked.revision.integrity.status, "valid");
    const published = await publishVisitV2({ visitId: created.visit._id, actorUserId: user._id });
    assert.equal(published.revision.status, "published");

    const copied = await copyVisitV2({
      sourceVisitId: created.visit._id,
      ownerType: "user",
      ownerId: user._id,
      title: "Copia indipendente",
      actorUserId: user._id,
    });
    assert.equal(String(copied.visit.copiedFromVisitId), String(created.visit._id));
    assert.equal(String(copied.visit.copiedFromVisitRevisionId), String(published.revision._id));
    assert.equal(String(copied.revision.editorialSources[0].editorialReleaseId), String(editorialRelease._id));
    assert.equal(String(copied.revision.visitAnchors[0].venueTargetId), String(target._id));
    assert.notEqual(String(copied.revision.editorialSources[0]._id), String(published.revision.editorialSources[0]._id));
    assert.notEqual(String(copied.revision.visitAnchors[0]._id), String(published.revision.visitAnchors[0]._id));
    assert.equal(copied.revision.deliveryMode, "synchronized");
    assert.equal(copied.revision.synchronization.joinAlias, "Fenice rossa");
    assert.equal(copied.revision.quiz.questions[0].question, "Chi è l'autore?");
    assert.notEqual(String(copied.revision.quiz.questions[0]._id), String(published.revision.quiz.questions[0]._id));

    await updateVisitV2({ visitId: created.visit._id, payload: { title: "Originale modificata dopo la copia" }, actorUserId: user._id });
    const refreshedCopy = await VisitRevisionV2.findById(copied.visit.workingRevisionId).lean();
    assert.equal(refreshedCopy.title, "Copia indipendente");
    assert.equal(String(refreshedCopy.contentEntries[0].itemRevisionId), String(itemRevision._id));

    const unavailableRelease = await VenueRelease.create({
      venueId: venue._id,
      version: 2,
      basedOnReleaseId: venueRelease._id,
      layoutRevisionId: layout._id,
      targetBindings: [{ venueTargetId: target._id, availability: "unavailable", recognitionMedia: [] }],
      status: "published",
      integrity: { status: "valid", issues: [], checkedAt: new Date(), checkedBy: user._id },
      publication: { publishedAt: new Date(), publishedBy: user._id },
      createdBy: user._id,
      updatedBy: user._id,
    });
    const audit = await auditVisitsAgainstVenueRelease({ venueId: venue._id, venueReleaseId: unavailableRelease._id });
    assert.equal(audit.affectedVisits.length, 1);
    assert.equal(String(audit.affectedVisits[0].visitId), String(created.visit._id));
    assert.deepEqual(audit.affectedVisits[0].unavailableVenueTargetIds, [String(target._id)]);
    const sourcePublishedAfterAudit = await VisitRevisionV2.findById(published.revision._id).lean();
    assert.equal(sourcePublishedAfterAudit.status, "published");

    const incompleteSynchronized = await createVisitV2({
      actorUserId: user._id,
      payload: {
        ownerType: "user",
        ownerId: user._id,
        title: "Sincronizzata incompleta",
        deliveryMode: "synchronized",
        synchronization: { joinAlias: "" },
        quiz: { questions: [] },
      },
    });
    const incompleteCheck = await evaluateVisitV2Consistency({ visitId: incompleteSynchronized.visit._id, actorUserId: user._id });
    const issueCodes = incompleteCheck.revision.integrity.issues.map((issue) => issue.code);
    assert.ok(issueCodes.includes("SYNCHRONIZED_JOIN_ALIAS_REQUIRED"));
    assert.ok(issueCodes.includes("SYNCHRONIZED_QUIZ_REQUIRED"));
  });
});
