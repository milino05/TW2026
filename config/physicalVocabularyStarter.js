function semantic(scheme, id, matchType = "exact") {
  return { scheme, id, matchType };
}

function localization(aliases = []) {
  return [{ locale: "it-IT", aliases }];
}

function base({ key, label, description, aliases = [], semanticRefs = [], metadata = {} }) {
  return { key, label, description, localizations: localization(aliases), semanticRefs, metadata };
}

const PLACE_TYPES = Object.freeze([
  base({ key: "room", label: "Sala", description: "Spazio visitabile o ambiente espositivo.", aliases: ["stanza", "ambiente", "galleria"], semanticRefs: [semantic("openstreetmap-tag", "indoor=room")], metadata: { navigationTarget: false } }),
  base({ key: "entrance", label: "Ingresso", description: "Punto ordinario di accesso alla sede.", aliases: ["entrata", "accesso"], semanticRefs: [semantic("openstreetmap-tag", "entrance=yes")], metadata: { navigationTarget: true } }),
  base({ key: "exit", label: "Uscita", description: "Punto ordinario di uscita dalla sede.", aliases: ["uscita principale"], semanticRefs: [semantic("openstreetmap-tag", "entrance=exit")], metadata: { navigationTarget: true } }),
  base({ key: "emergency_exit", label: "Uscita di emergenza", description: "Uscita destinata alle situazioni di emergenza.", aliases: ["uscita di sicurezza"], semanticRefs: [semantic("openstreetmap-tag", "emergency=exit")], metadata: { navigationTarget: true } }),
  base({ key: "toilets", label: "Servizi igienici", description: "Area con servizi igienici per i visitatori.", aliases: ["toilette", "bagno", "bagni", "wc", "servizi"], semanticRefs: [semantic("openstreetmap-tag", "amenity=toilets")], metadata: { navigationTarget: true } }),
  base({ key: "cafe", label: "Bar / Caffetteria", description: "Punto di ristoro interno o collegato alla sede.", aliases: ["bar", "caffetteria", "cafe"], semanticRefs: [semantic("openstreetmap-tag", "amenity=cafe")], metadata: { navigationTarget: true } }),
  base({ key: "shop", label: "Negozio / Bookshop", description: "Spazio di vendita della sede.", aliases: ["negozio", "bookshop", "gift shop"], semanticRefs: [semantic("openstreetmap-tag", "shop=gift", "close")], metadata: { navigationTarget: true } }),
  base({ key: "information_point", label: "Punto informazioni", description: "Punto di assistenza e informazione per i visitatori.", aliases: ["info point", "informazioni", "reception"], semanticRefs: [semantic("openstreetmap-tag", "tourism=information")], metadata: { navigationTarget: true } }),
  base({ key: "cloakroom", label: "Guardaroba", description: "Spazio per il deposito temporaneo di abiti e oggetti.", aliases: ["guardaroba", "deposito borse"], semanticRefs: [semantic("openstreetmap-tag", "amenity=cloakroom")], metadata: { navigationTarget: true } }),
  base({ key: "elevator", label: "Ascensore", description: "Punto di accesso a un ascensore.", aliases: ["elevatore", "lift"], semanticRefs: [semantic("openstreetmap-tag", "highway=elevator")], metadata: { navigationTarget: true } }),
  base({ key: "stairs", label: "Scale", description: "Punto di accesso a una scala tra livelli.", aliases: ["scala", "gradini", "scalinata"], semanticRefs: [semantic("openstreetmap-tag", "highway=steps")], metadata: { navigationTarget: true } }),
  base({ key: "waiting_area", label: "Area di attesa", description: "Spazio in cui sostare in attesa.", aliases: ["attesa", "zona di attesa"], semanticRefs: [semantic("openstreetmap-tag", "amenity=lounge", "close")], metadata: { navigationTarget: true } }),
  base({ key: "other", label: "Altro", description: "Tipo di luogo non coperto dalle definizioni disponibili.", aliases: ["altro luogo"], metadata: { navigationTarget: false } }),
].map((entry) => Object.freeze(entry)));

const CONNECTION_TYPES = Object.freeze([
  base({ key: "passage", label: "Passaggio", description: "Collegamento pedonale generico tra due luoghi.", aliases: ["passaggio pedonale", "varco"], semanticRefs: [semantic("openstreetmap-tag", "highway=footway", "broader")] }),
  base({ key: "corridor", label: "Corridoio", description: "Percorso interno lineare tra ambienti.", aliases: ["corridoio interno"], semanticRefs: [semantic("openstreetmap-tag", "indoor=corridor")] }),
  base({ key: "door", label: "Porta", description: "Connessione che attraversa una porta.", aliases: ["porta", "uscio"], semanticRefs: [semantic("openstreetmap-tag", "door=yes")] }),
  base({ key: "ramp", label: "Rampa", description: "Connessione inclinata percorribile tra quote diverse.", aliases: ["rampa accessibile", "piano inclinato"], semanticRefs: [semantic("openstreetmap-tag", "ramp=yes")] }),
  base({ key: "stairs", label: "Scala", description: "Connessione composta da gradini.", aliases: ["scale", "gradinata"], semanticRefs: [semantic("openstreetmap-tag", "highway=steps")] }),
  base({ key: "elevator", label: "Ascensore", description: "Connessione verticale servita da ascensore.", aliases: ["elevatore", "lift"], semanticRefs: [semantic("openstreetmap-tag", "highway=elevator")] }),
  base({ key: "outdoor_link", label: "Collegamento esterno", description: "Tratto del percorso situato all'esterno.", aliases: ["percorso esterno"], semanticRefs: [semantic("openstreetmap-tag", "indoor=no", "close")] }),
  base({ key: "other", label: "Altro", description: "Tipo di connessione non coperto dalle definizioni disponibili.", aliases: ["altra connessione"] }),
]);

const PHYSICAL_ATTRIBUTES = Object.freeze([
  { ...base({ key: "has_steps", label: "Presenza di gradini", description: "Indica se il tratto include uno o più gradini.", aliases: ["gradini", "scale"], semanticRefs: [semantic("openstreetmap-tag", "step_count=*")], metadata: { obstacleIndicator: true, obstacleWhen: true } }), dataType: "boolean", unit: null, options: [], appliesTo: "connection" },
  { ...base({ key: "step_free", label: "Accessibile senza gradini", description: "Indica un passaggio percorribile senza superare gradini.", aliases: ["senza gradini", "accesso a raso"], semanticRefs: [semantic("openstreetmap-tag", "wheelchair=yes", "close")], metadata: { obstacleIndicator: true, obstacleWhen: false } }), dataType: "boolean", unit: null, options: [], appliesTo: "both" },
  { ...base({ key: "minimum_width_cm", label: "Larghezza minima", description: "Larghezza minima utile del passaggio, espressa in centimetri.", aliases: ["larghezza passaggio"], semanticRefs: [semantic("openstreetmap-tag", "width=*")] }), dataType: "number", unit: "cm", options: [], appliesTo: "connection" },
  { ...base({ key: "narrow_passage", label: "Passaggio stretto", description: "Indica che il tratto presenta una strozzatura significativa.", aliases: ["strettoia", "passaggio angusto"], semanticRefs: [semantic("openstreetmap-tag", "width=limited", "close")], metadata: { obstacleIndicator: true, obstacleWhen: true } }), dataType: "boolean", unit: null, options: [], appliesTo: "connection" },
  { ...base({ key: "tactile_guidance", label: "Guida tattile", description: "Indica la presenza di una guida tattile lungo il percorso.", aliases: ["percorso tattile", "pavimentazione tattile"], semanticRefs: [semantic("openstreetmap-tag", "tactile_paving=yes")] }), dataType: "boolean", unit: null, options: [], appliesTo: "both" },
  { ...base({ key: "obstacles", label: "Presenza di ostacoli", description: "Indica ostacoli rilevanti per la percorribilità.", aliases: ["ostacoli", "impedimenti"], semanticRefs: [semantic("openstreetmap-tag", "obstacle=*")], metadata: { obstacleIndicator: true, obstacleWhen: true } }), dataType: "boolean", unit: null, options: [], appliesTo: "both" },
  { ...base({ key: "slope_percent", label: "Pendenza", description: "Pendenza longitudinale del tratto in percentuale.", aliases: ["inclinazione", "pendenza percentuale"], semanticRefs: [semantic("openstreetmap-tag", "incline=*")] }), dataType: "number", unit: "%", options: [], appliesTo: "connection" },
  { ...base({ key: "sensory_load", label: "Carico sensoriale", description: "Livello indicativo di rumore, affollamento e stimoli ambientali.", aliases: ["rumore", "stimoli sensoriali"] }), dataType: "choice", unit: null, options: [{ value: "low", label: "Basso" }, { value: "medium", label: "Medio" }, { value: "high", label: "Alto" }], appliesTo: "both" },
  { ...base({ key: "quiet_area", label: "Area tranquilla", description: "Indica un luogo adatto a una sosta con ridotto carico sensoriale.", aliases: ["zona tranquilla", "area calma"] }), dataType: "boolean", unit: null, options: [], appliesTo: "place" },
]);

const ROUTING_PROFILES = Object.freeze([
  { ...base({ key: "accessible", label: "Percorso accessibile", description: "Privilegia passaggi senza gradini, sufficientemente ampi e privi di ostacoli.", aliases: ["accessibile", "carrozzina"] }), requirements: [
    { attributeKey: "step_free", operator: "eq", value: true, priority: "required", weight: 10 },
    { attributeKey: "minimum_width_cm", operator: "gte", value: 80, priority: "preferred", weight: 4 },
    { attributeKey: "obstacles", operator: "eq", value: false, priority: "preferred", weight: 4 },
  ] },
  { ...base({ key: "step_free", label: "Percorso senza scale", description: "Esclude i tratti dichiarati con gradini.", aliases: ["senza scale", "senza gradini"] }), requirements: [
    { attributeKey: "has_steps", operator: "eq", value: false, priority: "required", weight: 10 },
    { attributeKey: "step_free", operator: "eq", value: true, priority: "preferred", weight: 5 },
  ] },
  { ...base({ key: "quiet", label: "Percorso tranquillo", description: "Riduce l'esposizione a zone con elevato carico sensoriale.", aliases: ["tranquillo", "silenzioso"] }), requirements: [
    { attributeKey: "sensory_load", operator: "eq", value: "low", priority: "preferred", weight: 5 },
    { attributeKey: "quiet_area", operator: "eq", value: true, priority: "preferred", weight: 3 },
  ] },
  { ...base({ key: "shortest", label: "Percorso più breve", description: "Ottimizza la lunghezza geometrica del percorso quando non sono presenti vincoli ulteriori.", aliases: ["rapido", "più breve"], metadata: { optimization: "shortest" } }), requirements: [] },
]);

module.exports = {
  STARTER_VERSION: 1,
  STARTER_LABEL: "Starter fisico ArtAround",
  PLACE_TYPES,
  CONNECTION_TYPES,
  PHYSICAL_ATTRIBUTES,
  ROUTING_PROFILES,
};
