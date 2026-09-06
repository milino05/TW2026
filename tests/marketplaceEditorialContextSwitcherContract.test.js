const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const read = (relative) => fs.readFileSync(path.join(root, relative), "utf8");
const shell = read("clients/marketplace/src/ui/app-shell.js");
const switcher = read("clients/marketplace/src/ui/editorial-context-switcher.js");
const shellCss = read("clients/marketplace/src/styles/context-shell.css");
const workspace = read("clients/marketplace/src/ui/workspace-browser-view.js");

test("la shell espone area di lavoro e spazio editoriale come due livelli dello stesso contesto", () => {
  assert.match(shell, /import "\.\/editorial-context-switcher\.js"/);
  assert.match(shell, /<artaround-editorial-context-switcher><\/artaround-editorial-context-switcher>/);
  assert.match(switcher, /contextKindLabel/);
  assert.match(switcher, /Spazio editoriale/);
  assert.match(switcher, /data-change-operating-context/);
  assert.match(switcher, /data-editorial-context-toggle/);
  assert.match(shellCss, /\.context-identity__levels/);
  assert.match(shellCss, /\.context-identity__owner/);
  assert.match(shellCss, /\.context-identity__space/);
});

test("lo spazio corrente deriva dalla preferenza dell'area operativa e non da un campo del form", () => {
  assert.match(switcher, /editorialRepository\.spaceSummaries/);
  assert.match(switcher, /resolveEditorialSpacePreference/);
  assert.match(switcher, /setEditorialSpacePreference/);
  assert.match(switcher, /ownerType: context\.type/);
  assert.match(switcher, /ownerId: context\.id/);
  assert.match(switcher, /EDITORIAL_SPACE_CHANGED/);
});

test("cambiare spazio rispetta la protezione da perdita dati e non ricontestualizza silenziosamente un editor aperto", () => {
  assert.match(switcher, /confirmNavigationLoss/);
  assert.match(switcher, /kind: "editorial-space"/);
  assert.match(switcher, /LEAVE_RESOURCE_ON_SWITCH_ROUTES/);
  assert.match(switcher, /"\/workspace\/item-authoring"/);
  assert.match(switcher, /"\/workspace\/editorial-studio"/);
  assert.match(switcher, /navigate\("\/workspace"\)/);
});

test("la Libreria mantiene il pannello dedicato allo spazio durante la sperimentazione del nuovo switcher", () => {
  assert.match(workspace, /library-current-space/);
  assert.match(workspace, /Spazio editoriale corrente/);
  assert.match(workspace, /data-change-space/);
  assert.match(workspace, /data-space-settings/);
});

test("il selettore degli spazi resta compatto nella shell ma apre una superficie leggibile", () => {
  assert.match(shellCss, /\.context-space-popover/);
  assert.match(shellCss, /width:min\(24rem,calc\(100vw - 2rem\)\)/);
  assert.match(shellCss, /\.context-space-list/);
  assert.match(shellCss, /max-height:min\(24rem,55vh\)/);
  assert.match(switcher, /Gestisci spazi in Libreria/);
});
