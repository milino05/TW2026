const test = require("node:test");
const assert = require("node:assert/strict");
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

test("dataset demo V3 conserva i requisiti quantitativi d'esame", () => {
  assert.deepEqual(REQUIRED_USERNAMES, ["autore1", "autore2", "visitatore1", "visitatore2"]);
  assert.equal(REQUIRED_PASSWORD, "12345678");
  assert.equal(MUSEUM_PLANS.length, 3);
  assert.equal(MUSEUM_PLANS.filter((entry) => entry.owner === "autore1").length, 2);
  assert.equal(MUSEUM_PLANS.filter((entry) => entry.owner === "autore2").length, 1);
  assert.ok(MUSEUM_PLANS.every((entry) => entry.works.length === 12));
  assert.ok(MUSEUM_PLANS.every((entry) => allSubjects(entry).length > entry.works.length));
  assert.equal(MUSEUM_PLANS.flatMap((entry) => entry.visits).length, 6);
  assert.equal(MUSEUM_PLANS.flatMap((entry) => entry.visits).filter((entry) => entry.synchronized).length, 2);
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
