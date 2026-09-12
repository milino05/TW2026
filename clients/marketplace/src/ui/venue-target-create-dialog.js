import { managementRepository } from "../infrastructure/http/management-repository.js";
import { createTaskDialog } from "./task-dialog.js";
import "./semantic-entity-picker.js";

function escapeHtml(value = "") {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}
function id(value) { return String(value?._id || value?.id || value || ""); }
function sourceLabel(value) {
  return ({
    venue_exposed: "Esposto in questa sede",
    venue_inventory: "Inventario della sede",
    organization_content: "Contenuto del museo",
    artaround: "ArtAround",
  })[value] || "ArtAround";
}
function candidateList(entries, title) {
  if (!entries?.length) return "";
  return `<section class="venue-subject-results"><strong>${escapeHtml(title)}</strong>${entries.map((entry) => `<button class="venue-subject-result" type="button" data-use-venue-subject="${escapeHtml(entry.id)}"><span><b>${escapeHtml(entry.preferredLabel)}</b><small>${escapeHtml(entry.description || "Senza descrizione")}</small></span><span class="chip">${escapeHtml(sourceLabel(entry.source))}</span></button>`).join("")}</section>`;
}

export function openVenueTargetCreateDialog({ venueId, onCreated = null, onExisting = null, onDismiss = null } = {}) {
  let query = "";
  let candidates = null;
  let selectedSubject = null;
  let busy = false;
  let error = null;
  let controller = null;

  const renderBody = () => {
    const exact = candidateList(candidates?.exact, "Corrispondenze esatte");
    const suggestions = candidateList(candidates?.suggestions, "Possibili corrispondenze — verifica prima di scegliere");
    const fallback = candidates && !candidates.exact?.length
      ? `<section class="venue-semantic-fallback"><h3>Ricerca estesa</h3><p>Nessuna corrispondenza esatta nell’inventario. ArtAround può continuare su Wikidata; le corrispondenze approssimative non vengono selezionate automaticamente.</p><artaround-semantic-entity-picker mode="subject" entity-kind="item" initial-query="${escapeHtml(query)}" auto-search></artaround-semantic-entity-picker></section>`
      : "";
    const selected = selectedSubject
      ? `<article class="selected-subject"><span class="eyebrow">Subject selezionato</span><strong>${escapeHtml(selectedSubject.preferredLabel || selectedSubject.label || "Subject")}</strong><small>${escapeHtml(selectedSubject.description || "Senza descrizione")}</small><form data-create-target><input type="hidden" name="subjectId" value="${escapeHtml(id(selectedSubject))}"><label>Etichetta locale facoltativa<input name="displayLabelOverride" placeholder="Usa il nome del Subject"></label><label>Nota d’inventario<textarea name="inventoryNote"></textarea></label><button type="submit" ${busy ? "disabled" : ""}>Aggiungi all’inventario</button></form></article>`
      : "";
    return `${error ? `<p role="alert">${escapeHtml(error)}</p>` : ""}<form data-venue-subject-search class="venue-subject-search"><label>Cerca un’opera, una persona o un luogo<input name="query" minlength="2" value="${escapeHtml(query)}" required></label><button type="submit" ${busy ? "disabled" : ""}>${busy ? "Ricerca…" : "Cerca"}</button></form>${exact}${suggestions}${fallback}${selected}`;
  };

  const refresh = () => controller?.render();
  const close = (options = {}) => controller?.close(options);

  controller = createTaskDialog({
    eyebrow: "Inventario della sede",
    title: "Aggiungi un’entità",
    description: "Cerca o identifica il Subject che rappresenta l’entità fisica. Item e contenuti editoriali restano risorse separate.",
    size: "large",
    initialFocus: '[name="query"]',
    renderBody,
    renderFooter: () => `<button class="button-secondary" type="button" data-modal-dismiss ${busy ? "disabled" : ""}>Annulla</button>`,
    isBusy: () => busy,
    onDismiss,
    onClick: (event) => {
      const target = event.target instanceof Element ? event.target : null;
      const use = target?.closest("[data-use-venue-subject]");
      if (!use) return;
      const all = [...(candidates?.exact || []), ...(candidates?.suggestions || [])];
      const candidate = all.find((entry) => id(entry.id) === id(use.dataset.useVenueSubject));
      if (!candidate) return;
      const existingTargetId = id(candidate.inventory?.venueTargetId);
      if (existingTargetId) {
        close({ reason: "existing" });
        onExisting?.(existingTargetId);
        return;
      }
      selectedSubject = candidate;
      error = null;
      refresh();
      controller.focus('[name="displayLabelOverride"]');
    },
    onSubmit: async (event) => {
      const form = event.target instanceof HTMLFormElement ? event.target : null;
      if (!form) return;
      if (form.matches("[data-venue-subject-search]")) {
        event.preventDefault();
        query = String(new FormData(form).get("query") || "").trim();
        if (query.length < 2) return;
        busy = true;
        error = null;
        selectedSubject = null;
        refresh();
        try { candidates = await managementRepository.searchVenueSubjectCandidates(venueId, query); }
        catch (reason) { error = reason instanceof Error ? reason.message : "Ricerca non riuscita"; }
        finally { busy = false; refresh(); }
        return;
      }
      if (!form.matches("[data-create-target]")) return;
      event.preventDefault();
      const data = new FormData(form);
      busy = true;
      error = null;
      refresh();
      try {
        const result = await managementRepository.createVenueTarget(venueId, {
          subjectId: String(data.get("subjectId") || ""),
          displayLabelOverride: String(data.get("displayLabelOverride") || "").trim() || null,
          inventoryNote: String(data.get("inventoryNote") || "").trim() || null,
          provenance: { origin: "human" },
        });
        close({ reason: "created" });
        onCreated?.(result);
      } catch (reason) {
        error = reason instanceof Error ? reason.message : "Non è stato possibile aggiungere l’entità";
        busy = false;
        refresh();
      }
    },
  });

  controller.layer.addEventListener("subject-selected", (event) => {
    if (!event.detail?.subject) return;
    selectedSubject = event.detail.subject;
    error = null;
    refresh();
    controller.focus('[name="displayLabelOverride"]');
  });

  return controller;
}
