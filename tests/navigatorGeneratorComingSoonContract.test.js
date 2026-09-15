const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
const router = read("clients/navigator/src/application/router.ts");
const app = read("clients/navigator/src/ui/App.vue");
const library = read("clients/navigator/src/ui/LibraryView.vue");
const comingSoon = read("clients/navigator/src/ui/GeneratorComingSoonView.vue");

test("tutte le entrate del generatore portano alla schermata coming soon", () => {
  assert.match(router, /import GeneratorComingSoonView/);
  assert.equal((router.match(/component: GeneratorComingSoonView/g) || []).length, 4);
  assert.doesNotMatch(router, /import GenerateView|import GeneratedPlanView/);
  assert.match(app, /name: 'generator-coming-soon'/);
  assert.equal((library.match(/name: 'generator-coming-soon'/g) || []).length, 2);
});

test("la schermata coming soon permette di tornare alla libreria o ai musei", () => {
  assert.match(comingSoon, /Coming soon/);
  assert.match(comingSoon, /Il generatore di visite sta arrivando/);
  assert.match(comingSoon, /name: "museum-library"/);
  assert.match(comingSoon, /name: "museums"/);
});
