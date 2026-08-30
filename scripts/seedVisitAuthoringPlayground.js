const crypto = require("crypto");
const path = require("path");
require("dotenv").config({ path: path.join(__dirname, "..", ".env") });

const mongoose = require("mongoose");
const User = require("../models/user");
const Organization = require("../models/organization.model");
const Venue = require("../models/venue.model");
const Subject = require("../models/subject.model");
const VenueTarget = require("../models/venueTarget.model");
const ExhibitSlot = require("../models/exhibitSlot.model");
const PhysicalVocabulary = require("../models/physicalVocabulary.model");
const PhysicalVocabularyRevision = require("../models/physicalVocabularyRevision.model");
const LayoutRevision = require("../models/layoutRevision.model");
const VenueRelease = require("../models/venueRelease.model");
const { applyPhysicalStarter } = require("../services/physicalVocabularyStarter.service");
const { computeVenueReleaseIssues } = require("../services/venueReleaseIntegrity.service");
const { ensureStarterRoles, replaceMembershipWithStarterRole } = require("../services/organizationBootstrap.service");

const WORKS = [
  ["luce-chiostro", "Luce nel chiostro"],
  ["ritratto-rosso", "Ritratto in rosso"],
  ["paesaggio-blu", "Paesaggio blu"],
  ["scultura-vento", "Scultura del vento"],
  ["citta-notturna", "Città notturna"],
];

function stableObjectId(scope, key) {
  return new mongoose.Types.ObjectId(
    crypto.createHash("sha1").update(`visit-authoring-playground:${scope}:${key}`).digest("hex").slice(0, 24),
  );
}

function stablePublicCode(scope, key) {
  return `as_visitui_${crypto.createHash("sha1").update(`${scope}:${key}`).digest("hex").slice(0, 16)}`;
}

async function main() {
  if (!process.env.MONGO_URI) throw new Error("MONGO_URI mancante");
  const username = String(process.argv[2] || "visitatore1").trim().toLowerCase();

  await mongoose.connect(process.env.MONGO_URI);
  try {
    const user = await User.findOne({ username, status: "active" });
    if (!user) throw new Error(`Utente attivo non trovato: ${username}`);

    const scope = String(user._id);
    const now = new Date();
    const ids = {
      organization: stableObjectId(scope, "organization"),
      venue: stableObjectId(scope, "venue"),
      physicalVocabulary: stableObjectId(scope, "physical-vocabulary"),
      physicalVocabularyRevision: stableObjectId(scope, "physical-vocabulary-revision"),
      layoutRevision: stableObjectId(scope, "layout-revision"),
      venueRelease: stableObjectId(scope, "venue-release"),
      floor: stableObjectId(scope, "floor"),
    };

    const organization = await Organization.findOneAndUpdate(
      { _id: ids.organization },
      {
        $set: {
          name: `Museo Playground Visite (${username})`,
          description: "Organizzazione dimostrativa per testare il composer delle visite.",
          lifecycleStatus: "active",
          trashedAt: null,
          trashedBy: null,
        },
        $setOnInsert: {
          createdBy: user._id,
          owners: [{ userId: user._id, grantedBy: user._id, grantedAt: now }],
        },
      },
      { upsert: true, new: true, runValidators: true },
    );

    await ensureStarterRoles({ organizationId: organization._id, actorUserId: user._id });
    await replaceMembershipWithStarterRole({
      organizationId: organization._id,
      userId: user._id,
      starterKey: "administrator",
      actorUserId: user._id,
    });

    const venue = await Venue.findOneAndUpdate(
      { _id: ids.venue },
      {
        $set: {
          name: "Sede Playground — Piano terra",
          description: "Cinque opere fisiche collegate in sequenza per testare le visite.",
          lifecycleStatus: "active",
          trashedAt: null,
          trashedBy: null,
        },
        $setOnInsert: {
          ownerOrganizationId: organization._id,
          createdBy: user._id,
        },
      },
      { upsert: true, new: true, runValidators: true },
    );

    let physicalVocabulary = await PhysicalVocabulary.findById(ids.physicalVocabulary);
    if (!physicalVocabulary) {
      physicalVocabulary = await PhysicalVocabulary.create({
        _id: ids.physicalVocabulary,
        name: "Vocabolario fisico Playground Visite",
        description: "Starter fisico minimo per il playground delle visite.",
        ownerType: "organization",
        ownerId: organization._id,
        createdBy: user._id,
      });
    }

    let vocabularyRevision = await PhysicalVocabularyRevision.findById(ids.physicalVocabularyRevision);
    if (!vocabularyRevision) {
      const snapshot = applyPhysicalStarter({}).snapshot;
      vocabularyRevision = await PhysicalVocabularyRevision.create({
        _id: ids.physicalVocabularyRevision,
        physicalVocabularyId: physicalVocabulary._id,
        version: 1,
        ...snapshot,
        status: "published",
        integrity: { status: "valid", issues: [], checkedAt: now, checkedBy: user._id },
        publication: { publishedAt: now, publishedBy: user._id },
        createdBy: user._id,
        updatedBy: user._id,
      });
    }
    physicalVocabulary.publishedRevisionId = vocabularyRevision._id;
    physicalVocabulary.lifecycleStatus = "active";
    await physicalVocabulary.save();

    const roomType = vocabularyRevision.placeTypes.find((entry) => entry.key === "room");
    const corridorType = vocabularyRevision.connectionTypes.find((entry) => entry.key === "corridor");
    if (!roomType || !corridorType) throw new Error("Starter fisico incompleto: room/corridor mancanti");

    const stops = [];
    for (let index = 0; index < WORKS.length; index += 1) {
      const [key, label] = WORKS[index];
      const subjectId = stableObjectId(scope, `subject:${key}`);
      const targetId = stableObjectId(scope, `target:${key}`);
      const slotId = stableObjectId(scope, `slot:${key}`);
      const placeId = stableObjectId(scope, `place:${key}`);

      const subject = await Subject.findOneAndUpdate(
        { _id: subjectId },
        {
          $set: {
            preferredLabel: label,
            description: `Opera dimostrativa “${label}” del playground per la creazione delle visite.`,
          },
          $setOnInsert: { createdBy: user._id },
        },
        { upsert: true, new: true, runValidators: true },
      );

      const target = await VenueTarget.findOneAndUpdate(
        { _id: targetId },
        {
          $set: {
            displayLabelOverride: label,
            inventoryNote: `Tappa fisica ${index + 1} del percorso demo.`,
            provenance: { origin: "human", sourceId: "visit-authoring-playground" },
            lifecycleStatus: "active",
            trashedAt: null,
            trashedBy: null,
          },
          $setOnInsert: {
            venueId: venue._id,
            subjectId: subject._id,
            createdBy: user._id,
          },
        },
        { upsert: true, new: true, runValidators: true },
      );

      const slot = await ExhibitSlot.findOneAndUpdate(
        { _id: slotId },
        {
          $set: { lifecycleStatus: "active", trashedAt: null, trashedBy: null },
          $setOnInsert: {
            venueId: venue._id,
            publicCode: stablePublicCode(scope, key),
            createdBy: user._id,
          },
        },
        { upsert: true, new: true, runValidators: true },
      );

      stops.push({ key, label, subject, target, slot, placeId, index });
    }

    const places = stops.map((stop) => ({
      _id: stop.placeId,
      floorId: ids.floor,
      placeTypeDefinitionId: roomType.definitionId,
      label: stop.label,
      position: { x: 0.1 + stop.index * 0.2, y: 0.5 },
      attributeValues: [],
    }));

    const connections = stops.slice(0, -1).map((stop, index) => ({
      _id: stableObjectId(scope, `connection:${index + 1}`),
      fromPlaceId: stop.placeId,
      toPlaceId: stops[index + 1].placeId,
      directionality: "bidirectional",
      connectionTypeDefinitionId: corridorType.definitionId,
      metricMode: "manual_override",
      distanceMeters: 8,
      additionalDelaySeconds: 0,
      attributeValues: [],
      instructions: {
        forward: `Prosegui verso ${stops[index + 1].label}.`,
        backward: `Torna verso ${stop.label}.`,
      },
    }));

    const layout = await LayoutRevision.findOneAndUpdate(
      { _id: ids.layoutRevision },
      {
        $set: {
          version: 1,
          floors: [{ _id: ids.floor, label: "Piano terra", mapAsset: null, calibration: null }],
          places,
          exhibitSlots: stops.map((stop) => ({
            exhibitSlotId: stop.slot._id,
            placeId: stop.placeId,
            label: stop.label,
            order: stop.index,
            approachGuidance: { defaultInstruction: `Raggiungi ${stop.label}.`, overrides: [] },
          })),
          connections,
          status: "published",
          updatedBy: user._id,
        },
        $setOnInsert: {
          venueId: venue._id,
          authoredAgainstPhysicalVocabularyRevisionId: vocabularyRevision._id,
          createdBy: user._id,
        },
      },
      { upsert: true, new: true, runValidators: true },
    );

    const releaseData = {
      _id: ids.venueRelease,
      venueId: venue._id,
      version: 1,
      layoutRevisionId: layout._id,
      targetBindings: stops.map((stop) => ({
        venueTargetId: stop.target._id,
        exhibitSlotId: stop.slot._id,
        availability: "active",
        recognitionMedia: [],
      })),
      preVisitInformation: ["Dataset di test: tutte le tappe sono sul piano terra."],
      status: "published",
      integrity: { status: "valid", issues: [], checkedAt: now, checkedBy: user._id },
      review: {
        requestedAt: now,
        requestedBy: user._id,
        reviewedAt: now,
        reviewedBy: user._id,
        decision: "approved",
        events: [
          { action: "review_requested", actorUserId: user._id, at: now, message: null },
          { action: "published", actorUserId: user._id, at: now, message: null },
        ],
      },
      publication: { publishedAt: now, publishedBy: user._id },
      createdBy: user._id,
      updatedBy: user._id,
    };

    const releaseCandidate = new VenueRelease(releaseData);
    const issues = await computeVenueReleaseIssues({ venue, release: releaseCandidate, layout });
    const blockers = issues.filter((issue) => issue.severity !== "warning");
    if (blockers.length) throw new Error(`Configurazione fisica non valida: ${JSON.stringify(blockers)}`);

    const release = await VenueRelease.findOneAndUpdate(
      { _id: ids.venueRelease },
      {
        $set: {
          version: 1,
          layoutRevisionId: layout._id,
          targetBindings: releaseData.targetBindings,
          preVisitInformation: releaseData.preVisitInformation,
          status: "published",
          integrity: releaseData.integrity,
          review: releaseData.review,
          publication: releaseData.publication,
          updatedBy: user._id,
        },
        $setOnInsert: {
          venueId: venue._id,
          createdBy: user._id,
        },
      },
      { upsert: true, new: true, runValidators: true },
    );

    venue.publishedReleaseId = release._id;
    venue.workingReleaseId = null;
    await venue.save();

    console.log(`Playground visite pronto per ${username}`);
    console.log(`Organizzazione: ${organization.name}`);
    console.log(`Sede: ${venue.name}`);
    console.log("Subject/opere fisiche disponibili:");
    for (const stop of stops) console.log(`- ${stop.label} (Subject ${stop.subject._id})`);
    console.log("\nPer testare l'associazione automatica, crea un contenuto usando uno di questi Subject e poi aggiungilo a una nuova visita.");
  } finally {
    await mongoose.disconnect();
  }
}

main().catch(async (error) => {
  console.error(error);
  await mongoose.disconnect().catch(() => {});
  process.exit(1);
});
