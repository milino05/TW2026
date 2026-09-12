const test = require("node:test");
const assert = require("node:assert/strict");
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
