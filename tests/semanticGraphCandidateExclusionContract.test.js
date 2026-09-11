const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const read = (relative) => fs.readFileSync(path.join(root, relative), "utf8");

test("il Subject Browser esclude il focus lato server prima della paginazione", () => {
  const browser = read("clients/marketplace/src/ui/semantic-subject-source-browser.js");
  const repository = read("clients/marketplace/src/infrastructure/http/editorial-repository.js");
  const controller = read("controllers/editorialContexts.controller.js");
  const service = read("services/editorialContextGraph.service.js");

  assert.match(browser, /excludeSubjectIds:\s*this\.excludeSubjectIds/);
  assert.match(repository, /excludeSubjectIds:\s*excluded \|\| null/);
  assert.match(controller, /excludeSubjectIds:\s*commaSeparatedValues\(req\.query\?\.excludeSubjectIds\)/);
  assert.match(service, /const eligibleCandidateIds = excludedSet\.size[\s\S]*candidateIds\.filter/);
  assert.match(service, /subjectIds:\s*eligibleCandidateIds/);

  const exclusionIndex = service.indexOf("const eligibleCandidateIds =");
  const paginationCountIndex = service.indexOf("Subject.countDocuments(query)");
  assert.ok(exclusionIndex >= 0, "la service deve applicare le esclusioni");
  assert.ok(paginationCountIndex > exclusionIndex, "le esclusioni devono avvenire prima di count/skip/limit");
});
