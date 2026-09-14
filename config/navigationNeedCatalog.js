const NAVIGATION_SEMANTIC_SCHEME = "artaround-physical";
const PERSONAL_NAVIGATION_PRIORITIES = Object.freeze(["preferred", "required"]);

function need(definition) {
  return Object.freeze({
    defaultPriority: "preferred",
    allowedPriorities: PERSONAL_NAVIGATION_PRIORITIES,
    valueMode: "fixed",
    advanced: false,
    ...definition,
    semanticRef: Object.freeze({
      scheme: NAVIGATION_SEMANTIC_SCHEME,
      id: definition.id,
      matchType: "exact",
    }),
  });
}

const NAVIGATION_NEED_CATALOG = Object.freeze([
  need({
    id: "step_free",
    attributeKey: "step_free",
    label: "Percorso senza gradini",
    description: "Privilegia collegamenti e spazi percorribili senza superare gradini.",
    dataType: "boolean",
    unit: null,
    appliesTo: "both",
    operator: "eq",
    value: true,
  }),
  need({
    id: "obstacles_present",
    attributeKey: "obstacles",
    label: "Evita ostacoli",
    description: "Privilegia tratti dichiarati privi di ostacoli rilevanti per la percorribilità.",
    dataType: "boolean",
    unit: null,
    appliesTo: "both",
    operator: "eq",
    value: false,
  }),
  need({
    id: "tactile_guidance",
    attributeKey: "tactile_guidance",
    label: "Preferisci guida tattile",
    description: "Privilegia tratti e spazi dotati di guida tattile quando la sede la documenta.",
    dataType: "boolean",
    unit: null,
    appliesTo: "both",
    operator: "eq",
    value: true,
  }),
  need({
    id: "narrow_passage",
    attributeKey: "narrow_passage",
    label: "Evita passaggi stretti",
    description: "Privilegia percorsi che non presentano strettoie dichiarate dalla sede.",
    dataType: "boolean",
    unit: null,
    appliesTo: "connection",
    operator: "eq",
    value: false,
  }),
  need({
    id: "minimum_width_cm",
    attributeKey: "minimum_width_cm",
    label: "Larghezza minima del passaggio",
    description: "Richiedi o preferisci una larghezza minima utile espressa in centimetri.",
    dataType: "number",
    unit: "cm",
    appliesTo: "connection",
    operator: "gte",
    valueMode: "user",
    advanced: true,
  }),
  need({
    id: "slope_percent",
    attributeKey: "slope_percent",
    label: "Pendenza massima",
    description: "Richiedi o preferisci che la pendenza non superi il valore indicato.",
    dataType: "number",
    unit: "%",
    appliesTo: "connection",
    operator: "lte",
    valueMode: "user",
    advanced: true,
  }),
]);

const NAVIGATION_NEED_BY_ID = new Map(NAVIGATION_NEED_CATALOG.map((entry) => [entry.id, entry]));

function navigationNeedById(id) {
  return NAVIGATION_NEED_BY_ID.get(String(id || "").trim()) || null;
}

function semanticNeedId(physicalFeatureRef) {
  if (physicalFeatureRef?.kind !== "semantic") return null;
  const refs = Array.isArray(physicalFeatureRef.semanticRefs) ? physicalFeatureRef.semanticRefs : [];
  const match = refs.find((entry) =>
    String(entry?.scheme || "").toLowerCase() === NAVIGATION_SEMANTIC_SCHEME
    && String(entry?.matchType || "exact").toLowerCase() === "exact"
    && NAVIGATION_NEED_BY_ID.has(String(entry?.id || "")),
  );
  return match ? String(match.id) : null;
}

function canonicalPhysicalFeatureRef(id) {
  const definition = navigationNeedById(id);
  if (!definition) return null;
  return {
    kind: "semantic",
    semanticRefs: [{ ...definition.semanticRef }],
  };
}

function projectNavigationNeedCatalog() {
  return NAVIGATION_NEED_CATALOG.map((entry) => ({
    id: entry.id,
    label: entry.label,
    description: entry.description,
    dataType: entry.dataType,
    unit: entry.unit,
    valueMode: entry.valueMode,
    ...(entry.valueMode === "fixed" ? { value: entry.value } : {}),
    allowedPriorities: [...entry.allowedPriorities],
    defaultPriority: entry.defaultPriority,
    advanced: entry.advanced,
  }));
}

module.exports = {
  NAVIGATION_SEMANTIC_SCHEME,
  PERSONAL_NAVIGATION_PRIORITIES,
  NAVIGATION_NEED_CATALOG,
  navigationNeedById,
  semanticNeedId,
  canonicalPhysicalFeatureRef,
  projectNavigationNeedCatalog,
};
