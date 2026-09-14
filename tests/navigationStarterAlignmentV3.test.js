const test = require("node:test");
const assert = require("node:assert/strict");

const { NAVIGATION_NEED_CATALOG } = require("../config/navigationNeedCatalog");
const { applyPhysicalStarter } = require("../services/physicalVocabularyStarter.service");

function exactSemanticMatch(definition, needId) {
  return (definition.semanticRefs || []).some((reference) => (
    String(reference.scheme || "").toLowerCase() === "artaround-physical"
    && String(reference.id || "") === needId
    && String(reference.matchType || "exact").toLowerCase() === "exact"
  ));
}

test("lo starter fisico crea tutte le caratteristiche canoniche globali e le rende assegnabili ai collegamenti", () => {
  const snapshot = applyPhysicalStarter({}).snapshot;

  assert.ok(NAVIGATION_NEED_CATALOG.length > 0);
  for (const need of NAVIGATION_NEED_CATALOG) {
    const matches = snapshot.physicalAttributes.filter((definition) => exactSemanticMatch(definition, need.id));
    assert.equal(matches.length, 1, `manca o e ambiguo il vincolo starter ${need.id}`);

    const definition = matches[0];
    assert.equal(definition.dataType, need.dataType, `${need.id}: dataType non allineato`);
    assert.equal(definition.unit ?? null, need.unit ?? null, `${need.id}: unita non allineata`);
    assert.equal(definition.appliesTo, need.appliesTo, `${need.id}: scope non allineato`);
    assert.ok(
      ["connection", "both"].includes(definition.appliesTo),
      `${need.id}: il vincolo globale deve essere configurabile sui collegamenti`,
    );
  }
});
