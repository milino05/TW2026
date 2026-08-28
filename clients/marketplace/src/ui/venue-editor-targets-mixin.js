import { icon } from "./icons.js";
import { managementRepository } from "../infrastructure/http/management-repository.js";

function escapeHtml(value = "") { return String(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#039;"); }
function selected(value, current) { return String(value || "") === String(current || "") ? "selected" : ""; }
function has(operations, code) { return (operations || []).some((entry) => entry.code === code); }
function availabilityLabel(value) { return value === "active" ? "Disponibile" : "Temporaneamente non disponibile"; }
function fileAsBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.addEventListener("load", () => resolve(String(reader.result || "").split(",")[1] || ""), { once: true });
    reader.addEventListener("error", () => reject(new Error("Non è stato possibile leggere l'immagine")), { once: true });
    reader.readAsDataURL(file);
  });
}
function canvasAsBlob(canvas, mimeType, quality) {
  return new Promise((resolve, reject) => canvas.toBlob(
    (blob) => blob ? resolve(blob) : reject(new Error("Non è stato possibile ottimizzare l'immagine")),
    mimeType,
    quality,
  ));
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
  const upload = editable ? `<form data-recognition-media-upload="${escapeHtml(target.id)}" class="venue-recognition-upload"><label class="venue-recognition-file"><span>Aggiungi immagine</span><small>JPEG, PNG, WebP o AVIF · massimo 2 MB. È un riferimento fisico per riconoscere l'oggetto, non un contenuto editoriale.</small><input name="file" type="file" accept="image/jpeg,image/png,image/webp,image/avif" required></label><label>Descrizione dell'immagine<input name="altText" maxlength="500" placeholder="Es. Vista frontale della scultura"></label><button type="submit">${icon("image", { size: 15 })} Carica immagine</button></form>` : "";
  return `<div class="venue-recognition-media"><div class="venue-recognition-heading"><div><strong>Immagini di riconoscimento</strong><small>Aiutano il Navigator e le future funzioni di riconoscimento a riferirsi all'oggetto fisico.</small></div><span class="count">${media.length}</span></div>${cards ? `<div class="venue-recognition-media-grid">${cards}</div>` : `<p class="note">Nessuna immagine di riconoscimento configurata.</p>`}${upload}</div>`;
}

export const venueTargetsMixin = {
  async handleTargetMediaClick(event) {
    const target = event.target instanceof Element ? event.target : null;
    const remove = target?.closest("[data-remove-recognition-media]");
    if (!remove) return false;
    if (!window.confirm(`Rimuovere questa immagine di riconoscimento da “${remove.dataset.targetLabel || "questo oggetto"}”?`)) return true;
    await this.execute(
      () => managementRepository.removeVenueTargetRecognitionMedia(this.id, remove.dataset.targetId, remove.dataset.removeRecognitionMedia),
      "Immagine di riconoscimento rimossa.",
    );
    return true;
  },

  async handleTargetMediaSubmit(form, data) {
    if (!form.matches("[data-recognition-media-upload]")) return false;
    const file = data.get("file");
    if (!(file instanceof File) || !file.size) throw new Error("Scegli un'immagine da caricare.");
    const optimized = await optimizedRecognitionMedia(file);
    const dataBase64 = await fileAsBase64(optimized);
    await this.execute(() => managementRepository.uploadVenueTargetRecognitionMedia(
      this.id,
      form.dataset.recognitionMediaUpload,
      {
        fileName: optimized.name || file.name,
        mimeType: optimized.type || file.type,
        dataBase64,
        altText: String(data.get("altText") || "").trim(),
      },
    ), "Immagine di riconoscimento caricata.");
    return true;
  },

  renderTargets(editable) {
    const cards = this.data.targets.map((entry) => `<article class="venue-target-card"><header><div><span class="eyebrow">${escapeHtml(entry.subject?.label || "Identità non disponibile")}</span><h3>${escapeHtml(entry.label)}</h3></div><span class="chip">${entry.binding ? escapeHtml(availabilityLabel(entry.binding.availability)) : "Non incluso nella release"}</span></header><p>${escapeHtml(entry.description || "Nessuna descrizione fisica.")}</p><details><summary>Dettagli oggetto</summary><form data-target-metadata="${escapeHtml(entry.id)}"><label>Nome nella sede<input name="label" value="${escapeHtml(entry.label)}" required></label><label>Descrizione fisica<textarea name="description">${escapeHtml(entry.description || "")}</textarea></label><button type="submit">Salva oggetto</button>${has(entry.availableOperations, "venue.target.trash") ? `<button class="danger" type="button" data-trash-target="${escapeHtml(entry.id)}" data-label="${escapeHtml(entry.label)}">Sposta nel cestino</button>` : ""}</form></details>${this.data.release ? `<details ${entry.binding?.recognitionMedia?.length ? "open" : ""}><summary>Disponibilità e riconoscimento</summary>${editable ? `<form data-target-availability="${escapeHtml(entry.id)}" class="venue-target-availability"><label>Disponibilità<select name="availability"><option value="active" ${selected("active", entry.binding?.availability || "active")}>Disponibile</option><option value="unavailable" ${selected("unavailable", entry.binding?.availability)}>Temporaneamente non disponibile</option></select></label><button class="button-secondary" type="submit">${icon("check", { size: 16 })} Salva disponibilità</button></form>` : `<p class="note">${escapeHtml(availabilityLabel(entry.binding?.availability || "active"))}</p>`}${renderRecognitionMedia(entry, editable)}</details>` : ""}</article>`).join("");
    const selectedSubject = this.selectedSubject ? `<article class="selected-subject"><span class="eyebrow">Identità selezionata</span><strong>${escapeHtml(this.selectedSubject.preferredLabel)}</strong><small>${escapeHtml(this.selectedSubject.description || "Senza descrizione")}</small></article><form data-create-target><input type="hidden" name="subjectId" value="${escapeHtml(this.selectedSubject.id || this.selectedSubject._id)}"><label>Nome dell'oggetto nella sede<input name="label" required value="${escapeHtml(this.selectedSubject.preferredLabel)}"></label><label>Descrizione fisica<textarea name="description"></textarea></label><button type="submit">Crea oggetto fisico</button></form>` : "";
    return `<section class="venue-section" id="venue-targets"><div class="section-heading"><div><span class="eyebrow">Oggetti</span><h2>Oggetti e punti di interesse</h2><p>Ogni VenueTarget identifica una presenza fisica nella sede e rimane separato dagli Item editoriali.</p></div><span class="count">${this.data.targets.length}</span></div><div class="venue-target-grid">${cards || `<div class="empty-state"><h3>Nessun oggetto configurato</h3><p>Aggiungi opere o punti di interesse presenti fisicamente nella sede.</p></div>`}</div>${editable ? `<details class="venue-create"><summary>${icon("plus", { size: 16 })} Aggiungi oggetto</summary><p>Cerca prima il Subject condiviso. La scelta non crea un Item e non copia contenuti editoriali.</p><artaround-semantic-entity-picker mode="subject" entity-kind="item"></artaround-semantic-entity-picker>${selectedSubject}</details>` : ""}</section>`;
  },

  renderVisitors(editable) {
    const values = this.data.release?.preVisitInformation || [];
    return `<section class="venue-section" id="venue-visitors"><div class="section-heading"><div><span class="eyebrow">Informazioni visitatori</span><h2>Prima della visita</h2><p>Indicazioni logistiche mostrate prima dell'ingresso nella visita. Non sono Item.</p></div><span class="count">${values.length}</span></div>${this.data.release ? `<form data-previsit><label>Una informazione per riga<textarea name="preVisitInformation" rows="7" ${editable ? "" : "disabled"}>${escapeHtml(values.join("\n"))}</textarea></label>${editable ? `<button type="submit">${icon("check", { size: 16 })} Salva informazioni</button>` : ""}</form>` : `<div class="empty-state"><h3>Avvia una bozza fisica</h3><p>Le informazioni visitatori fanno parte della VenueRelease.</p></div>`}</section>`;
  },
};
