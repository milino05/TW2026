const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const read = (relative) => fs.readFileSync(path.join(root, relative), "utf8");
const library = read("clients/marketplace/src/ui/workspace-browser-view.js");
const shell = read("clients/marketplace/src/ui/app-shell.js");

test("la Libreria usa una sola barra di navigazione con tre tab di pari livello", () => {
  assert.match(library, /data-library-tab="collections"[^>]*>Raccolte<\/button>/);
  assert.match(library, /data-library-tab="content"[^>]*>Contenuti<\/button>/);
  assert.match(library, /data-library-tab="resources"[^>]*>Risorse condivise<\/button>/);
  assert.doesNotMatch(library, /data-library-section=/);
  assert.doesNotMatch(library, /data-editorial-section=/);
  assert.match(library, /class="context-workspace-tabs library-tabs"/);
});

test("il pannello di scope precede sempre le tab della Libreria", () => {
  assert.match(library, /\$\{this\.renderLibraryScope\(\)\}\$\{this\.renderLibraryTabs\(\)\}/);
  assert.match(library, /renderLibraryScope\(\) \{\s*return this\.section === "resources" \? this\.renderWorkAreaScope\(\) : this\.renderEditorialScope\(\);/);
});

test("Raccolte e Contenuti mostrano lo Spazio editoriale, Risorse condivise mostra l'Area di lavoro", () => {
  assert.match(library, /renderEditorialScope\(\)/);
  assert.match(library, /<span class="eyebrow">Spazio editoriale<\/span>/);
  assert.match(library, /renderWorkAreaScope\(\)/);
  assert.match(library, /<span class="eyebrow">Area di lavoro<\/span>/);
  assert.match(library, /Risorse disponibili trasversalmente agli spazi editoriali/);
});

test("le risorse cross-space sono presentate come Risorse condivise senza cambiare il loro ownership", () => {
  assert.match(library, /const CROSS_SPACE_TYPES = \["visit", "namespace", "semantic_graph", "physical_vocabulary"\]/);
  assert.match(library, /ownership: "owned"/);
  assert.match(library, /<span class="eyebrow">Risorse condivise<\/span>/);
  assert.match(library, /riutilizzabili trasversalmente agli spazi editoriali/);
});

test("il selettore globale Personale\/Organizzazione resta separato dallo Spazio editoriale", () => {
  assert.match(shell, /data-change-context/);
  assert.match(shell, /renderContextIdentity\(\)/);
  assert.doesNotMatch(shell, /editorial-context-switcher/);
  assert.doesNotMatch(shell, /EDITORIAL_SPACE_CHANGED/);
});
