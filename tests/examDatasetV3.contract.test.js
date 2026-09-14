const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const {
  REQUIRED_USERNAMES,
  REQUIRED_PASSWORD,
  MUSEUM_PLANS,
  artNamespaceSnapshot,
  archaeologyNamespaceSnapshot,
  allSubjects,
} = require("../scripts/examDatasetV3");
const DEMO_VENUE_LAYOUTS = require("../scripts/demoVenueLayouts.json");

test("dataset demo V3 conserva i requisiti quantitativi d'esame", () => {
  assert.deepEqual(REQUIRED_USERNAMES, ["autore1", "autore2", "visitatore1", "visitatore2"]);
  assert.equal(REQUIRED_PASSWORD, "12345678");
  assert.equal(MUSEUM_PLANS.length, 3);
  assert.equal(MUSEUM_PLANS.filter((entry) => entry.owner === "autore1").length, 2);
  assert.equal(MUSEUM_PLANS.filter((entry) => entry.owner === "autore2").length, 1);
  assert.ok(MUSEUM_PLANS.every((entry) => entry.works.length === 12));
  assert.ok(MUSEUM_PLANS.every((entry) => allSubjects(entry).length > entry.works.length));
  assert.equal(MUSEUM_PLANS.flatMap((entry) => entry.visits).length, 6);
  const groupPrepared = MUSEUM_PLANS.flatMap((entry) => entry.visits).filter((entry) => entry.groupSessionDefaults?.preferredJoinAlias && entry.quiz);
  assert.equal(groupPrepared.length, 2);
  assert.ok(groupPrepared.every((entry) => typeof entry.groupSessionDefaults.preferredJoinAlias === "string"));
  assert.ok(MUSEUM_PLANS.flatMap((entry) => entry.visits).every((entry) => entry.synchronized === undefined));
  assert.ok(MUSEUM_PLANS.flatMap((entry) => entry.visits).every((entry) => entry.indexes.length >= 10));
  assert.equal(MUSEUM_PLANS.find((entry) => entry.key === "pinacoteca").visits.length, 3);
});

test("regole editoriali demo espongono le matrici richieste", () => {
  const art = artNamespaceSnapshot();
  assert.equal(art.durationTypes.length, 3);
  assert.equal(art.languageLevels.length, 3);
  assert.equal(art.relationTypes.length, 3);
  assert.deepEqual(art.durationTypes.map((entry) => entry.label), ["Breve", "Media", "Approfondita"]);
  assert.deepEqual(art.languageLevels.map((entry) => entry.label), ["Semplice", "Divulgativo", "Specialistico"]);

  const archaeology = archaeologyNamespaceSnapshot();
  assert.equal(archaeology.durationTypes.length, 2);
  assert.equal(archaeology.languageLevels.length, 2);
  assert.equal(archaeology.relationTypes.length, 3);
});

test("i layout demo pubblicati restano portabili e completi", () => {
  const expectedCounts = {
    pinacoteca: { places: 32, connections: 34 },
    mambo: { places: 30, connections: 33 },
    archeologico: { places: 30, connections: 31 },
  };

  for (const [key, expected] of Object.entries(expectedCounts)) {
    const layout = DEMO_VENUE_LAYOUTS[key];
    assert.ok(layout);
    assert.equal(layout.floors.length, 1);
    assert.ok(layout.floors[0].calibration);
    assert.equal(layout.places.length, expected.places);
    assert.equal(layout.connections.length, expected.connections);
    assert.equal(layout.exhibitSlots.length, 12);
    assert.ok(fs.existsSync(path.join(__dirname, "..", "clients", "navigator", "public", layout.floors[0].mapAsset.url)));

    const placeIds = new Set(layout.places.map((place) => place._id));
    assert.ok(layout.exhibitSlots.every((slot) => placeIds.has(slot.placeId)));
    assert.ok(layout.connections.every((connection) => placeIds.has(connection.fromPlaceId) && placeIds.has(connection.toPlaceId)));
    assert.ok(layout.places.every((place) => place.placeTypeKey && place.placeTypeDefinitionId === undefined));
    assert.ok(layout.connections.every((connection) => connection.connectionTypeKey && connection.connectionTypeDefinitionId === undefined));
  }
});

test("le regole dei due musei d'arte restano allineate al modello culturale starter corrente", async () => {
  const starterPath = path.join(__dirname, "..", "clients", "marketplace", "src", "application", "namespace-editor-starter.js");
  const { starterDefinitions } = await import(pathToFileURL(starterPath).href);
  const starter = starterDefinitions({});
  const art = artNamespaceSnapshot();
  const pick = (values, fields) => values.map((entry) => Object.fromEntries(fields.map((field) => [field, entry[field]])));

  assert.deepEqual(pick(art.durationTypes, ["key", "label", "targetSeconds"]), pick(starter.durationTypes, ["key", "label", "targetSeconds"]));
  assert.deepEqual(pick(art.languageLevels, ["key", "label"]), pick(starter.languageLevels, ["key", "label"]));
  assert.deepEqual(pick(art.subjectClasses, ["key", "label"]), pick(starter.subjectClasses, ["key", "label"]));
  assert.deepEqual(pick(art.relationTypes, ["key", "label"]), pick(starter.relationTypes, ["key", "label"]));
  assert.deepEqual(pick(art.selectionSignals, ["key", "label"]), pick(starter.selectionSignals, ["key", "label"]));
});

test("il seed V3 persiste e verifica la dependency versionata Venue -> PhysicalVocabulary", () => {
  const source = fs.readFileSync(path.join(__dirname, "..", "scripts", "examDatasetV3.js"), "utf8");
  assert.match(source, /venue\.physicalVocabularyId = physical\.physicalVocabulary\._id/);
  assert.match(source, /versionPolicy: "follow_current"/);
  assert.match(source, /consumerSnapshotId: release\._id/);
  assert.match(source, /dependencyRevisionId: physical\.revision\._id/);
  assert.match(source, /buildValidation\(/);
  assert.match(source, /loadVenuePhysicalVocabulary\(venue, \{ requireStable: true, requireValidatedConsumer: true, consumerSnapshotId: venueRelease\._id \}\)/);
  assert.match(source, /VENUE_PHYSICAL_DEPENDENCY_INVALID/);
});
