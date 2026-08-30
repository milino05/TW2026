const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");

function javascriptFiles(root) {
  const files = [];
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    const fullPath = path.join(root, entry.name);
    if (entry.isDirectory()) files.push(...javascriptFiles(fullPath));
    else if (entry.isFile() && entry.name.endsWith(".js")) files.push(fullPath);
  }
  return files;
}

test("runtime services remain compatible with standalone MongoDB", () => {
  const offenders = [];
  for (const file of javascriptFiles(path.join(__dirname, "..", "services"))) {
    const source = fs.readFileSync(file, "utf8");
    if (/\.withTransaction\s*\(|\.startTransaction\s*\(/.test(source)) {
      offenders.push(path.relative(path.join(__dirname, ".."), file));
    }
  }
  assert.deepEqual(offenders, [], `Replica-set-only transactions found in: ${offenders.join(", ")}`);
});

test("deployment documentation declares standalone MongoDB support", () => {
  const deployment = fs.readFileSync(path.join(__dirname, "..", "docs", "deployment.md"), "utf8");
  assert.match(deployment, /MongoDB standalone/i);
  assert.doesNotMatch(deployment, /deve appartenere a un replica set/i);
});
