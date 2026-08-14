const fs = require("fs");
const path = require("path");

const roots = ["models", "schemas", "services", "controllers", "routes", "tests"];
const ignore = new Set(["scripts/checkSemanticGraphArchitecture.js"]);
const forbidden = [
  { re: /ItemRevision[^\n]{0,80}relations|revision\.relations|\.relations\.target|["']relations\.target["']/g, why: "embedded ItemRevision relations" },
  { re: /require\([^)]*relationView\.utils/g, why: "obsolete relationView.utils dependency" },
  { re: /validateRelations\b/g, why: "obsolete embedded relation validator" },
  { re: /RelationSchema\b/g, why: "obsolete embedded RelationSchema" },
];
const failures = [];
function walk(dir) {
  if (!fs.existsSync(dir)) return;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full);
    else if (entry.isFile() && full.endsWith(".js") && !ignore.has(full.replace(/\\/g, "/"))) {
      const text = fs.readFileSync(full, "utf8");
      for (const rule of forbidden) if (rule.re.test(text)) failures.push(`${full}: ${rule.why}`);
    }
  }
}
for (const root of roots) walk(root);
if (failures.length) {
  console.error("Legacy semantic graph architecture detected:\n" + [...new Set(failures)].join("\n"));
  process.exit(1);
}
console.log("Semantic graph architecture check passed");
