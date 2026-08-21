const fs = require("fs");
const path = require("path");
const targets = ["models/itemV2.model.js", "models/itemEdition.model.js", "models/itemRevisionV2.model.js"];
for (const file of targets) {
  const text = fs.readFileSync(path.join(process.cwd(), file), "utf8");
  for (const forbidden of ["museumId", "itemType"]) {
    if (new RegExp(`\\b${forbidden}\\b`).test(text)) {
      console.error(`Item v2 scaffold contains forbidden legacy field ${forbidden} in ${file}`);
      process.exit(1);
    }
  }
}
console.log("Item v2 scaffold is museum- and itemType-neutral.");
