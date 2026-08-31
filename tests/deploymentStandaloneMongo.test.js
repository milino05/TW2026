const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");

function javascriptFiles(directory) {
  const files = [];
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...javascriptFiles(fullPath));
    else if (entry.isFile() && entry.name.endsWith(".js")) files.push(fullPath);
  }
  return files;
}

test("runtime services do not bypass the Mongo capability boundary with explicit sessions", () => {
  const offenders = [];
  for (const file of javascriptFiles(path.join(root, "services"))) {
    const source = fs.readFileSync(file, "utf8");
    if (/\.withTransaction\s*\(|\.startTransaction\s*\(|\.startSession\s*\(/.test(source)) {
      offenders.push(path.relative(root, file));
    }
  }
  assert.deepEqual(offenders, [], `Explicit replica-set-only session APIs found in: ${offenders.join(", ")}`);
});

test("server and DB scripts install the Mongo unit-of-work compatibility boundary", () => {
  const index = fs.readFileSync(path.join(root, "index.js"), "utf8");
  const packageJson = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
  assert.match(index, /require\("\.\/config\/mongoUnitOfWork"\)/);
  for (const scriptName of [
    "seed:users",
    "migrate:organization-rbac",
    "migrate:exhibit-slots",
    "seed:demo",
    "verify:demo",
    "test",
  ]) {
    assert.match(packageJson.scripts[scriptName], /mongoUnitOfWork\.js/, `${scriptName} must preload Mongo compatibility`);
  }
  assert.match(packageJson.scripts.test, /testMongoEnvironment\.js/, "test must isolate its Mongo database");
});

test("deployment documentation declares standalone MongoDB support", () => {
  const deployment = fs.readFileSync(path.join(root, "docs", "deployment.md"), "utf8");
  assert.match(deployment, /MongoDB standalone/i);
  assert.doesNotMatch(deployment, /deve appartenere a un replica set/i);
});
