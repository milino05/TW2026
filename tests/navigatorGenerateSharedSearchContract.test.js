const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const read = (relative) => fs.readFileSync(path.join(root, relative), "utf8");
const generate = read("clients/navigator/src/ui/GenerateView.vue");
const controller = read("clients/navigator/src/application/searchController.ts");
const repository = read("clients/navigator/src/infrastructure/http/generatorRepository.ts");

test("Generate usa SearchController per la ricerca dei Subject", () => {
  assert.match(generate, /import \{ SearchController \}/);
  assert.match(generate, /new SearchController<GenerationSubjectOption, GenerationSubjectSearchResponse>/);
  assert.match(generate, /getResults: \(response\) => response\.results/);
  assert.match(generate, /subjectSearchMeta\.value = state\.result\?\.resolver/);
  assert.match(generate, /subjectSearchWarnings\.value = state\.result\?\.warnings/);
  assert.match(generate, /subjectSearch\.setQuery\(subjectQuery\.value\.trim\(\), \{ immediate: true \}\)/);
  assert.match(generate, /onBeforeUnmount\(\(\) => subjectSearch\.dispose\(\)\)/);
  assert.doesNotMatch(generate, /searchingSubjects\.value = true;\s*error\.value = null;\s*try\s*\{\s*const response = await generatorRepository\.searchSubjects/s);
});

test("la ricerca conserva resolver/warnings e invalida selezioni non più disponibili", () => {
  assert.match(generate, /new Set\(state\.results\.map\(\(entry\) => entry\.id\)\)/);
  assert.match(generate, /selectedSubjectIds\.value = selectedSubjectIds\.value\.filter/);
  assert.match(generate, /subjectSearchMeta\.value = state\.result\?\.resolver \?\? null/);
  assert.match(generate, /subjectSearchWarnings\.value = state\.result\?\.warnings \?\? \[\]/);
});

test("AbortSignal arriva fino al boundary HTTP", () => {
  assert.match(controller, /new AbortController\(\)/);
  assert.match(controller, /this\.options\.search\(query, \{ signal: controller\.signal \}\)/);
  assert.match(repository, /searchSubjects\([^)]*signal\?: AbortSignal\)/s);
  assert.match(repository, /signal,/);
});
