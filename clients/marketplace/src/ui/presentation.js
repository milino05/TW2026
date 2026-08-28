const RESOURCE_LABELS = Object.freeze({
  item_edition: "Contenuto",
  item_revision: "Versione del contenuto",
  visit: "Visita",
  visit_revision: "Versione della visita",
  editorial_context: "Raccolta editoriale",
  editorial_release: "Versione pubblicata della raccolta",
  namespace: "Regole editoriali",
  namespace_revision: "Versione delle regole editoriali",
  physical_vocabulary: "Vocabolario fisico",
  physical_vocabulary_revision: "Versione del vocabolario fisico",
  content_space: "Spazio editoriale",
});

const RESOURCE_STATE_LABELS = Object.freeze({
  working: "Bozza",
  draft: "Bozza",
  in_review: "In revisione",
  changes_requested: "Modifiche richieste",
  private: "Privato",
  published: "Pubblicata",
  withdrawn: "Ritirata",
  empty: "Da completare",
});

const INTEGRITY_LABELS = Object.freeze({
  valid: "Pronta",
  ready: "Pronta",
  invalid: "Da correggere",
  needs_review: "Da controllare",
  unchecked: "Da controllare",
});

const EDITOR_LABELS = Object.freeze({
  item_edition: "Modifica il contenuto",
  visit: "Modifica la visita",
  editorial_context: "Pubblica una nuova versione",
  namespace: "Modifica le regole editoriali",
  physical_vocabulary: "Modifica il vocabolario fisico",
});

export function resourceLabel(resourceType) {
  return RESOURCE_LABELS[String(resourceType || "")] || "Risorsa";
}

export function resourceStateLabel(state) {
  return RESOURCE_STATE_LABELS[String(state || "")] || String(state || "");
}

export function integrityLabel(status) {
  return INTEGRITY_LABELS[String(status || "")] || String(status || "");
}

export function editorLabel(resourceType, fallback = "Modifica") {
  return EDITOR_LABELS[String(resourceType || "")] || fallback;
}
