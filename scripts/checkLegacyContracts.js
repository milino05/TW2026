const fs=require("fs"),path=require("path");
const roots=["config","controllers","middlewares","models","routes","schemas","services"];
const forbidden=[
 {pattern:/\brevision\.stops\b/,label:"revision.stops"},
 {pattern:/\bstopObservations\b/,label:"stopObservations"},
 {pattern:/\bfromStopIndex\b/,label:"fromStopIndex"},
 {pattern:/\btoStopIndex\b/,label:"toStopIndex"},
 {pattern:/\bvisit_stop\b/,label:"visit_stop"},
 {pattern:/requestSnapshot\?\.interests|requestSnapshot\.interests/,label:"GenerationRequest.interests"},
 {pattern:/profile\?\.semanticAffinities|profile\.semanticAffinities/,label:"embedded semanticAffinities"},
];
const allowed=new Map([["services/validation/generation.validation.js",[/mustSeeItemIds/,/payload\.interests/]]]);
let failed=false;
function walk(dir){if(!fs.existsSync(dir))return;for(const name of fs.readdirSync(dir)){const file=path.join(dir,name),stat=fs.statSync(file);if(stat.isDirectory())walk(file);else if(file.endsWith(".js"))check(file)}}
function check(file){const normalized=file.split(path.sep).join("/"),text=fs.readFileSync(file,"utf8");for(const entry of forbidden){if(entry.pattern.test(text)){console.error(`Legacy contract ${entry.label} in ${normalized}`);failed=true}}if(/\bmustSeeItemIds\b/.test(text)&&!(allowed.get(normalized)||[]).some(pattern=>pattern.test(text))){console.error(`Legacy contract mustSeeItemIds in ${normalized}`);failed=true}}
 if(/payload\.interests\b/.test(text)&&normalized!=="services/validation/generation.validation.js"){console.error(`Legacy GenerationRequest interests in ${normalized}`);failed=true}}
}
roots.forEach(walk);if(failed)process.exit(1);console.log("No operational legacy visit/generator contracts found.");
