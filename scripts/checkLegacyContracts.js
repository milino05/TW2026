const fs = require('fs');
const path = require('path');

const roots = ['config', 'controllers', 'middlewares', 'models', 'routes', 'schemas', 'services'];
const forbidden = [
  { pattern: /\brevision\.stops\b/, label: 'revision.stops' },
  { pattern: /\bstopObservations\b/, label: 'stopObservations' },
  { pattern: /\bfromStopIndex\b/, label: 'fromStopIndex' },
  { pattern: /\btoStopIndex\b/, label: 'toStopIndex' },
  { pattern: /\bvisit_stop\b/, label: 'visit_stop' },
  { pattern: /requestSnapshot\?\.interests|requestSnapshot\.interests/, label: 'GenerationRequest.interests access' },
  { pattern: /requestSnapshot\s*:\s*\{[\s\S]{0,1800}?\binterests\s*:/, label: 'GenerationRequest.interests snapshot property' },
  { pattern: /profile\?\.semanticAffinities|profile\.semanticAffinities/, label: 'embedded semanticAffinities' },
  { pattern: /\brevision\.relations\b/, label: 'ItemRevision.relations' },
  { pattern: /["']relations\.relationTypeKey["']/, label: 'ItemRevision relationType dependency' },
  { pattern: /["']relations\.target["']/, label: 'ItemRevision relation target dependency' },
  { pattern: /relationView\.utils/, label: 'obsolete relationView.utils' },
  { pattern: /schemas\/relation\.schema|schemas\\relation\.schema/, label: 'obsolete embedded RelationSchema' },
];
let failed = false;

function check(file) {
  const normalized = file.split(path.sep).join('/');
  const text = fs.readFileSync(file, 'utf8');
  for (const entry of forbidden) {
    if (entry.pattern.test(text)) {
      console.error(`Legacy contract ${entry.label} in ${normalized}`);
      failed = true;
    }
  }
  if (/\bmustSeeItemIds\b/.test(text) && normalized !== 'services/validation/generation.validation.js') {
    console.error(`Legacy contract mustSeeItemIds in ${normalized}`);
    failed = true;
  }
  if (/payload\.interests\b/.test(text) && normalized !== 'services/validation/generation.validation.js') {
    console.error(`Legacy GenerationRequest interests in ${normalized}`);
    failed = true;
  }
}

function walk(dir) {
  if (!fs.existsSync(dir)) return;
  for (const name of fs.readdirSync(dir)) {
    const file = path.join(dir, name);
    const stat = fs.statSync(file);
    if (stat.isDirectory()) walk(file);
    else if (file.endsWith('.js')) check(file);
  }
}

roots.forEach(walk);
for (const obsolete of ['services/relationView.utils.js', 'schemas/relation.schema.js']) {
  if (fs.existsSync(obsolete)) {
    console.error(`Obsolete semantic graph file still present: ${obsolete}`);
    failed = true;
  }
}
for (const v2File of ['models/itemV2.model.js', 'models/itemEdition.model.js', 'models/itemRevisionV2.model.js']) {
  if (!fs.existsSync(v2File)) continue;
  const text = fs.readFileSync(v2File, 'utf8');
  for (const legacyField of ['museumId', 'itemType']) {
    if (new RegExp(`\\b${legacyField}\\b`).test(text)) {
      console.error(`Item v2 scaffold contains forbidden legacy field ${legacyField} in ${v2File}`);
      failed = true;
    }
  }
}
if (failed) process.exit(1);
console.log('No operational legacy visit/generator/semantic-graph contracts found.');
