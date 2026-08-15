const fs = require("fs");
const { execFileSync } = require("child_process");

const forbiddenTrackedPaths = new Set([
  "Shrek.jpg",
  "shrek.html",
  "appunti.txt",
  ".env",
]);

let trackedFiles = [];
try {
  trackedFiles = execFileSync("git", ["ls-files", "-z"], { encoding: "utf8" })
    .split("\0")
    .filter(Boolean);
} catch (error) {
  console.error("Impossibile verificare i file tracciati con git:", error.message);
  process.exit(1);
}

const violations = trackedFiles.filter(
  (file) => forbiddenTrackedPaths.has(file) || file.startsWith("node_modules/"),
);

for (const requiredFile of ["Dockerfile", "docker-compose.yml"]) {
  if (!fs.existsSync(requiredFile)) violations.push(`${requiredFile} (mancante)`);
}

if (violations.length) {
  console.error("Repository hygiene check fallito:");
  for (const violation of [...new Set(violations)]) console.error(`- ${violation}`);
  process.exit(1);
}

console.log("Repository hygiene check superato.");
