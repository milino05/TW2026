const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const { execFileSync } = require("node:child_process");

const root = path.resolve(__dirname, "..");
const read = (relative) => fs.readFileSync(path.join(root, relative), "utf8");
const marketplace = read("clients/marketplace/src/application/search-controller.js");
const navigator = read("clients/navigator/src/application/searchController.ts");

test("SearchController Marketplace supporta payload ricchi senza perdere results", () => {
  assert.match(marketplace, /result: null/);
  assert.match(marketplace, /getResults/);
  assert.match(marketplace, /this\.state\.result = result \?\? null/);
  assert.match(marketplace, /this\.state\.results = this\.getResults\(result\)/);
  assert.match(marketplace, /allowEmptyQuery/);
  assert.match(marketplace, /clear\(\)/);
  assert.match(marketplace, /AbortController/);
  execFileSync(process.execPath, ["--check", path.join(root, "clients/marketplace/src/application/search-controller.js")], { stdio: "pipe" });
});

test("SearchController Navigator mantiene lo stesso contratto tipizzato", () => {
  assert.match(navigator, /SearchState<T, TResult = T\[\]>/);
  assert.match(navigator, /SearchController<T, TResult = T\[\]>/);
  assert.match(navigator, /result: TResult \| null/);
  assert.match(navigator, /search: \(query: string, context: \{ signal: AbortSignal \}\) => Promise<TResult>/);
  assert.match(navigator, /getResults\?: \(result: TResult\) => T\[\]/);
  assert.match(navigator, /allowEmptyQuery\?: boolean/);
  assert.match(navigator, /clearSelection\(\)/);
});

test("una ricerca superseded non può pubblicare il proprio risultato", () => {
  for (const source of [marketplace, navigator]) {
    assert.match(source, /sequence !== this\.sequence/);
    assert.match(source, /controller\.signal\.aborted/);
    assert.match(source, /this\.abortController\?\.abort\(\)/);
    assert.match(source, /this\.state\.result = null/);
    assert.match(source, /setQuery[\s\S]*this\.state\.results = \[\]/);
  }
});

test("cambiare query invalida subito una richiesta in volo anche durante il debounce", async (context) => {
  const previousWindow = globalThis.window;
  globalThis.window = { setTimeout, clearTimeout };
  context.after(() => {
    if (previousWindow === undefined) delete globalThis.window;
    else globalThis.window = previousWindow;
  });

  const moduleUrl = pathToFileURL(path.join(root, "clients/marketplace/src/application/search-controller.js")).href;
  const { SearchController } = await import(moduleUrl);
  let resolveFirst;
  let firstSignal;
  const controller = new SearchController({
    debounceMs: 100,
    search: (query, { signal }) => {
      if (query === "prima") {
        firstSignal = signal;
        return new Promise((resolve) => { resolveFirst = resolve; });
      }
      return Promise.resolve({ results: [query] });
    },
  });

  const firstRun = controller.setQuery("prima", { immediate: true });
  assert.equal(firstSignal?.aborted, false);
  await controller.setQuery("seconda");
  assert.equal(firstSignal?.aborted, true);
  resolveFirst({ results: ["risultato obsoleto"] });
  await firstRun;
  assert.equal(controller.state.query, "seconda");
  assert.deepEqual(controller.state.results, []);
  assert.equal(controller.state.result, null);
  controller.dispose();
});
