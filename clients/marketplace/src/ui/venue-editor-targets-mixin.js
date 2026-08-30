import { icon } from "./icons.js";
import { managementRepository } from "../infrastructure/http/management-repository.js";

function escapeHtml(value = "") { return String(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#039;"); }
function selected(value, current) { return String(value || "") === String(current || "") ? "selected" : ""; }
function has(operations, code) { return (operations || []).some((entry) => entry.code === code); }
function id(value) { return String(value?._id || value?.id || value || ""); }
function availabilityLabel(value) { return value === "active" ? "Disponibile" : "Temporaneamente non disponibile"; }
function stateLabel(value) { return { exposed: "Esposto", unplaced: "Non collocato", unavailable: "Non disponibile" }[value] || "Inventario"; }
function sourceLabel(value) { return { venue_exposed: "Esposto in questa sede", venue_inventory: "Inventario della sede", organization_content: "Contenuto del museo", artaround: "ArtAround" }[value] || "ArtAround"; }
function fileAsBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.addEventListener("load", () => resolve(String(reader.result || "").split(",")[1] || ""), { once: true });
    reader.addEventListener("error", () => reject(new Error("Non è stato possibile leggere l'immagine")), { once: true });
    reader.readAsDataURL(file);
  });
}
function canvasAsBlob(canvas, mimeType, quality) {
  return new Promise((resolve, reject) => canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error("Non è stato possibile ottimizzare l'immagine")), mimeType, quality));
}
async function optimizedRecognitionMedia(file) {
  const allowed = new Set(["image/jpeg", "image/png", "image/webp", "image/avif"]);
  if (!allowed.has(file.type)) throw new Error("Usa un'immagine JPEG, PNG, WebP o AVIF.");
  const maxBytes = 2 * 1024 * 1024;
  if (file.size <= maxBytes) return file;
  if (typeof createImageBitmap !== "function") throw new Error("L'immagine supera 2 MB. Riduci il file prima di caricarlo.");
  let bitmap;
  try { bitmap = await createImageBitmap(file); }
  catch { throw new Error("L'immagine supera 2 MB e non può essere ottimizzata dal browser. Scegline una più leggera."); }
  try {
    for (const option of [{ maxSide: 2200, quality: .86 }, { maxSide: 1800, quality: .76 }, { maxSide: 1400, quality: .66 }]) {
      const scale = Math.min(1, option.maxSide / Math.max(bitmap.width, bitmap.height));
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.round(bitmap.width * scale));
      canvas.height = Math.max(1, Math.round(bitmap.height * scale));
      const context = canvas.getContext("2d");
      if (!context) throw new Error("Non è stato possibile preparare l'immagine");
      context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
      const optimized = await canvasAsBlob(canvas, "image/webp", option.quality);
      if (optimized.size <= maxBytes) return new File([optimized], file.name.replace(/\.[^.]+$/, ".webp"), { type: "image/webp" });
    }
  } finally { bitmap.close(); }
  throw new Error("Non è stato possibile ridurre l'immagine sotto 2 MB.");
}

function renderRecognitionMedia(target, editable) {
  const media = target.binding?.recognitionMedia || [];
  const cards = media.map((entry, index) => `<figure class="venue-recognition-media-card"><img src="${escapeHtml(entry.url)}" alt="${escapeHtml(entry.altText || `Immagine di riconoscimento ${index + 1} di ${target.label}`)}" loading="lazy"><figcaption><span>${escapeHtml(entry.altText || "Nessuna descrizione aggiuntiva")}</span>${editable && entry.id ? `<button class="danger small" type="button" data-remove-recognition-media="${escapeHtml(entry.id)}" data-target-id="${escapeHtml(target.id)}" data-target-label="${escapeHtml(target.label)}">${icon("trash", { size: 14 })} Rimuovi</button>` : ""}</figcaption></figure>`).join("");
  const upload = editable && target.binding ? `<form data-recognition-media-upload="${escapeHtml(target.id)}" class="venue-recognition-upload"><label class="venue-recognition-file"><span>Aggiungi immagine</span><small>Riferimento fisico, non contenuto editoriale · massimo 2 MB.</small><input name="file" type="file" accept="image/jpeg,image/png,image/webp,image/avif" required></label><label>Descrizione<input name="altText" maxlength="500" placeholder="Es. Vista frontale"></label><button type="submit">${icon("image", { size: 15 })} Carica</button></form>` : "";
  return `<div class="venue-recognition-media"><div class="venue-recognition-heading"><strong>Riconoscimento</strong><span class="count">${media.length}</span></div>${cards ? `<div class="venue-recognition-media-grid">${cards}</div>` : `<p class="note">Nessuna immagine configurata.</p>`}${upload}</div>`;
}

function renderTargetRemoval(target, pendingTargetRemovalId, busy) {
  if (!has(target.availableOperations, "venue.target.trash")) return "";
  if (String(pendingTargetRemovalId || "") !== String(target.id)) return `<button class="danger small" type="button" data-request-target-removal="${escapeHtml(target.id)}">Rimuovi dall’inventario</button>`;
  return `<section class="confirmation-panel resource-removal-confirmation" role="alert"><div><strong>Rimuovere “${escapeHtml(target.label)}” dall’inventario?</strong><p>Subject e Item non verranno eliminati. L’operazione è possibile solo se nessuna configurazione corrente usa l’entità.</p></div><div class="button-row"><button class="danger" type="button" data-confirm-target-removal="${escapeHtml(target.id)}" ${busy ? "disabled" : ""}>Rimuovi</button><button class="button-secondary" type="button" data-cancel-target-removal>Annulla</button></div></section>`;
}

function targetCard(entry, context) {
  const { editable, venueId, pendingTargetRemovalId, busy, selectedVenueTargetId } = context;
  const state = entry.configuration?.state || "unplaced";
  const itemHref = `/workspace/item-authoring?venueTargetId=${encodeURIComponent(id(entry.id))}`;
  const slot = entry.exhibitSlot;
  const counts = entry.museumContent || { available: 0, draft: 0 };
  const trash = renderTargetRemoval(entry, pendingTargetRemovalId, busy);
  const detach = has(entry.availableOperations, "venue.target.detach")
    ? `<button class="danger small" type="button" data-detach-target="${escapeHtml(entry.id)}" data-label="${escapeHtml(entry.label)}">Rimuovi dalla configurazione</button>`
    : "";
  return `<article class="venue-target-card${id(selectedVenueTargetId) === id(entry.id) ? " selected" : ""}" data-venue-entity-card="${escapeHtml(entry.id)}" data-state="${escapeHtml(state)}"><header><div><span class="eyebrow">${escapeHtml(entry.subject?.label || "Identità non disponibile")}</span><h3>${escapeHtml(entry.label)}</h3></div><span class="chip" data-tone="${state === "exposed" ? "success" : state === "unavailable" ? "warning" : "neutral"}">${escapeHtml(stateLabel(state))}</span></header><p>${escapeHtml(entry.inventoryNote || entry.subject?.description || "Nessuna nota d’inventario.")}</p><dl class="venue-command-facts"><div><dt>Contenuti disponibili</dt><dd>${counts.available || 0}</dd></div><div><dt>Bozze del museo</dt><dd>${counts.draft || 0}</dd></div></dl>${slot ? `<p class="venue-entity-location">${icon("pin", { size: 14 })} ${escapeHtml(slot.label)} <button class="link-button" type="button" data-locate-slot="${escapeHtml(id(slot.id))}">Localizza</button></p>` : `<p class="venue-entity-location muted">Nessuno slot assegnato</p>`}${editable ? `<div class="button-row"><a class="button-link small secondary" data-route href="${itemHref}">Crea contenuto</a>${slot ? `<button class="button-secondary small" type="button" data-unassign-target="${escapeHtml(entry.id)}">Scollega dallo slot</button>` : ""}</div><details><summary>Inventario e disponibilità</summary><form data-target-metadata="${escapeHtml(entry.id)}" class="venue-inline-form"><label>Etichetta locale<input name="displayLabelOverride" value="${escapeHtml(entry.displayLabelOverride || "")}" placeholder="Usa il nome del Subject"></label><label>Nota d’inventario<textarea name="inventoryNote">${escapeHtml(entry.inventoryNote || "")}</textarea></label><button>Salva</button></form>${entry.binding ? `<form data-target-availability="${escapeHtml(entry.id)}" class="venue-target-availability"><label>Disponibilità<select name="availability"><option value="active" ${selected("active", entry.binding.availability || "active")}>Disponibile</option><option value="unavailable" ${selected("unavailable", entry.binding.availability)}>Temporaneamente non disponibile</option></select></label><button class="button-secondary">Salva</button></form>` : ""}${renderRecognitionMedia(entry, editable)}${detach}${trash}</details>` : ""}</article>`;
}

function candidateList(entries, title) {
  if (!entries?.length) return "";
  return `<section class="venue-subject-results"><strong>${escapeHtml(title)}</strong>${entries.map((entry) => `<button class="venue-subject-result" type="button" data-use-venue-subject="${escapeHtml(entry.id)}"><span><b>${escapeHtml(entry.preferredLabel)}</b><small>${escapeHtml(entry.description || "Senza descrizione")}</small></span><span class="chip">${escapeHtml(sourceLabel(entry.source))}</span></button>`).join("")}</section>`;
}

export const venueTargetsMixin = {
  async handleTargetMediaClick(event) {
    const target = event.target instanceof Element ? event.target : null;
    const remove = target?.closest("[data-remove-recognition-media]");
    if (!remove) return false;
    this.requestDestructiveAction({ type: "recognition_media", targetId: remove.dataset.targetId, mediaId: remove.dataset.removeRecognitionMedia, title: `Rimuovere questa immagine da “${remove.dataset.targetLabel || "questa entità"}”?`, description: "L’asset resta conservato se uno snapshot storico lo usa.", confirmLabel: "Rimuovi immagine", successMessage: "Immagine di riconoscimento rimossa." });
    return true;
  },

  async handleTargetMediaSubmit(form, data) {
    if (!form.matches("[data-recognition-media-upload]")) return false;
    try {
      const file = data.get("file");
      if (!(file instanceof File) || !file.size) throw new Error("Scegli un'immagine da caricare.");
      const optimized = await optimizedRecognitionMedia(file);
      const dataBase64 = await fileAsBase64(optimized);
      await this.execute(() => managementRepository.uploadVenueTargetRecognitionMedia(this.id, form.dataset.recognitionMediaUpload, { fileName: optimized.name || file.name, mimeType: optimized.type || file.type, dataBase64, altText: String(data.get("altText") || "").trim() }), "Immagine di riconoscimento caricata.");
    } catch (error) { this.error = error instanceof Error ? error.message : "Caricamento non riuscito"; this.render(); }
    return true;
  },

  renderTargets(editable) {
    const filtered = (this.data.targets || []).filter((entry) => this.inventoryFilter === "all" || entry.configuration?.state === this.inventoryFilter);
    const cards = filtered.map((entry) => targetCard(entry, { editable, venueId: this.id, pendingTargetRemovalId: this.pendingTargetRemovalId, busy: this.busy, selectedVenueTargetId: this.selectedVenueTargetId })).join("");
    const exact = candidateList(this.venueSubjectCandidates?.exact, "Corrispondenze esatte");
    const suggestions = candidateList(this.venueSubjectCandidates?.suggestions, "Possibili corrispondenze — verifica prima di scegliere");
    const selectedSubject = this.selectedSubject ? `<article class="selected-subject"><span class="eyebrow">Subject selezionato</span><strong>${escapeHtml(this.selectedSubject.preferredLabel)}</strong><small>${escapeHtml(this.selectedSubject.description || "Senza descrizione")}</small><form data-create-target><input type="hidden" name="subjectId" value="${escapeHtml(id(this.selectedSubject))}"><label>Etichetta locale facoltativa<input name="displayLabelOverride" placeholder="Usa il nome condiviso"></label><label>Nota d’inventario<textarea name="inventoryNote"></textarea></label><button>Aggiungi all’inventario</button></form></article>` : "";
    const resolverFallback = this.venueSubjectCandidates && !this.venueSubjectCandidates.exact?.length
      ? `<details class="venue-semantic-fallback" open><summary>Ricerca estesa e creazione manuale</summary><p>Nessuna corrispondenza esatta nell’inventario: ArtAround continua automaticamente su Wikidata. Le corrispondenze approssimative non vengono selezionate automaticamente.</p><artaround-semantic-entity-picker mode="subject" entity-kind="item" initial-query="${escapeHtml(this.venueSubjectQuery)}" auto-search></artaround-semantic-entity-picker></details>`
      : "";
    const filters = [["all", "Tutte"], ["exposed", "Esposte"], ["unplaced", "Non collocate"], ["unavailable", "Non disponibili"]]
      .map(([value, label]) => `<button class="button-secondary small" type="button" data-inventory-filter="${value}" aria-pressed="${this.inventoryFilter === value}">${label}</button>`)
      .join("");
    const create = editable ? `<details class="venue-create"><summary>${icon("plus", { size: 16 })} Aggiungi entità all’inventario</summary><form data-venue-subject-search class="venue-subject-search"><label>Cerca un’opera, una persona o un luogo<input name="query" minlength="2" value="${escapeHtml(this.venueSubjectQuery)}" required></label><button>Cerca</button></form>${exact}${suggestions}${resolverFallback}${selectedSubject}</details>` : "";
    return `<section class="venue-arrangement-panel"><div class="venue-inventory-toolbar"><div><h3>Entità della sede</h3><p>Inventario interno della sede, distinto dagli Item e dagli slot.</p></div><div class="venue-filter-group" role="group" aria-label="Filtra inventario">${filters}</div></div><div class="venue-target-grid">${cards || `<div class="empty-state compact"><h4>Nessuna entità in questo filtro</h4></div>`}</div>${create}</section>`;
  },

  renderVisitors(editable) {
    const values = this.data.release?.preVisitInformation || [];
    return `<section class="venue-section" id="venue-visitors"><div class="section-heading"><div><span class="eyebrow">Informazioni visitatori</span><h2>Prima della visita</h2><p>Indicazioni logistiche mostrate prima dell’ingresso. Non sono Item.</p></div><span class="count">${values.length}</span></div>${this.data.release ? `<form data-previsit><label>Una informazione per riga<textarea name="preVisitInformation" rows="7" ${editable ? "" : "disabled"}>${escapeHtml(values.join("\n"))}</textarea></label>${editable ? `<button type="submit">${icon("check", { size: 16 })} Salva informazioni</button>` : ""}</form>` : `<div class="empty-state"><h3>Avvia una bozza fisica</h3></div>`}</section>`;
  },
};
