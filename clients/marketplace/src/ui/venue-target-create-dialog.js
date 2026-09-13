import { semanticRepository } from "../infrastructure/http/semantic-repository.js";
import { subjectPresenceRepository } from "../infrastructure/http/subject-presence-repository.js";
import { createTaskDialog } from "./task-dialog.js";
import "./semantic-entity-picker.js";

function escapeHtml(value = "") { return String(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#039;"); }
function id(value) { return String(value?._id || value?.id || value || ""); }
function hasOperation(subject, code) { return (subject?.availableOperations || []).some((entry) => entry.code === code); }
function usageLabel(entry) {
  const usage = entry.organizationUsage || {};
  const parts = [];
  if (usage.itemCount) parts.push(`${usage.itemCount} ${usage.itemCount === 1 ? "contenuto" : "contenuti"}`);
  if (usage.availableCount) parts.push(`${usage.availableCount} disponibili`);
  if (usage.draftCount) parts.push(`${usage.draftCount} ${usage.draftCount === 1 ? "bozza" : "bozze"}`);
  if (usage.collectionCount) parts.push(`${usage.collectionCount} ${usage.collectionCount === 1 ? "raccolta" : "raccolte"}`);
  if (usage.otherVenueCount) parts.push(`in ${usage.otherVenueCount} ${usage.otherVenueCount === 1 ? "altra sede" : "altre sedi"}`);
  return parts.join(" · ") || "Subject ArtAround";
}
function stateLabel(entry) {
  if (entry.inventory?.venueTargetId) return ({ exposed: "Esposto", unavailable: "Non disponibile", unplaced: "Già nell'inventario" })[entry.inventory.status] || "Già nell'inventario";
  if (entry.proposal) return "Proposta in attesa";
  return entry.source === "organization_content" ? "Usato dall'organizzazione" : "ArtAround";
}
function candidateCard(entry) {
  const media = entry.previewMedia;
  const disabled = Boolean(entry.inventory?.venueTargetId);
  return `<button class="venue-subject-browser-card${disabled ? " disabled" : ""}" type="button" data-use-venue-subject="${escapeHtml(id(entry))}" ${disabled ? "aria-disabled=\"true\"" : ""}>${media?.url ? `<img src="${escapeHtml(media.url)}" alt="${escapeHtml(media.altText || entry.preferredLabel || "")}" loading="lazy">` : `<span class="venue-subject-browser-placeholder" aria-hidden="true">◎</span>`}<span class="venue-subject-browser-copy"><strong>${escapeHtml(entry.preferredLabel)}</strong><small>${escapeHtml(entry.description || "Senza descrizione")}</small><span>${escapeHtml(usageLabel(entry))}</span></span><span class="chip">${escapeHtml(stateLabel(entry))}</span></button>`;
}

export function openVenueTargetCreateDialog({ venueId, sourceItemId = null, onChanged = null, onExisting = null, onDismiss = null } = {}) {
  let query = "";
  let page = 1;
  let candidates = null;
  let selectedSubject = null;
  let busy = false;
  let error = null;
  let notice = null;
  let externalMode = false;
  let controller = null;

  const candidateById = (subjectId) => (candidates?.results || []).find((entry) => id(entry) === id(subjectId))
    || [...(candidates?.exact || []), ...(candidates?.suggestions || [])].find((entry) => id(entry) === id(subjectId));

  const loadCandidates = async ({ resetPage = false } = {}) => {
    if (resetPage) page = 1;
    busy = true; error = null; notice = null; externalMode = false; selectedSubject = null; refresh();
    try { candidates = await semanticRepository.searchVenueSubjects(venueId, query, { limit: 24, page }); }
    catch (reason) { error = reason instanceof Error ? reason.message : "Subject non disponibili"; }
    finally { busy = false; refresh(); }
  };

  const selectSubject = (subject) => {
    if (!subject) return;
    if (subject.inventory?.venueTargetId) {
      notice = "Questo Subject è già presente nell'inventario della sede.";
      onExisting?.(subject.inventory.venueTargetId);
      selectedSubject = null;
      refresh();
      return;
    }
    selectedSubject = subject;
    error = null; notice = null; externalMode = false; refresh();
    requestAnimationFrame(() => controller?.focus?.('[name="displayLabelOverride"], [name="message"], [data-accept-selected-proposal]'));
  };

  const renderSelected = () => {
    if (!selectedSubject) return "";
    const proposal = selectedSubject.proposal;
    if (proposal && hasOperation(selectedSubject, "venue.inventory.accept_proposal")) {
      const withdraw = hasOperation(selectedSubject, "venue.inventory.withdraw_proposal") ? `<button class="button-secondary" type="button" data-withdraw-selected-proposal data-proposal-id="${escapeHtml(id(proposal.id))}" ${busy ? "disabled" : ""}>Ritira proposta</button>` : "";
      return `<section class="venue-subject-selected"><span class="eyebrow">Proposta in attesa</span><h3>${escapeHtml(selectedSubject.preferredLabel || "Subject")}</h3><p>${escapeHtml(selectedSubject.description || "")}</p><p>Esiste già una proposta per questo Subject. Per mantenere lo storico coerente, accettala invece di creare una seconda aggiunta.</p><div class="button-row"><button type="button" data-accept-selected-proposal data-proposal-id="${escapeHtml(id(proposal.id))}" ${busy ? "disabled" : ""}>Accetta nell'inventario</button>${withdraw}<button class="button-secondary" type="button" data-reset-subject-selection>Cambia Subject</button></div></section>`;
    }
    if (proposal) {
      const withdraw = hasOperation(selectedSubject, "venue.inventory.withdraw_proposal") ? `<button type="button" data-withdraw-selected-proposal data-proposal-id="${escapeHtml(id(proposal.id))}" ${busy ? "disabled" : ""}>Ritira proposta</button>` : "";
      return `<section class="venue-subject-selected"><span class="eyebrow">Proposta in attesa</span><h3>${escapeHtml(selectedSubject.preferredLabel || "Subject")}</h3><p>Questo Subject è già stato proposto alla sede. Non è necessario inviare una seconda proposta.</p><div class="button-row">${withdraw}<button class="button-secondary" type="button" data-reset-subject-selection>Cambia Subject</button></div></section>`;
    }
    const canManage = hasOperation(selectedSubject, "venue.inventory.add");
    const canPropose = hasOperation(selectedSubject, "venue.inventory.propose");
    if (canManage) {
      return `<section class="venue-subject-selected"><span class="eyebrow">Subject selezionato</span><h3>${escapeHtml(selectedSubject.preferredLabel || "Subject")}</h3><p>${escapeHtml(selectedSubject.description || "Senza descrizione")}</p><form data-add-selected-subject><label>Etichetta locale <small>facoltativa</small><input name="displayLabelOverride" maxlength="200" placeholder="Usa il nome del Subject"></label><label>Nota d'inventario <small>facoltativa</small><textarea name="inventoryNote" rows="3" maxlength="1000"></textarea></label><div class="button-row"><button type="submit" ${busy ? "disabled" : ""}>Aggiungi all'inventario</button><button class="button-secondary" type="button" data-reset-subject-selection>Cambia Subject</button></div></form></section>`;
    }
    if (canPropose) {
      return `<section class="venue-subject-selected"><span class="eyebrow">Subject selezionato</span><h3>${escapeHtml(selectedSubject.preferredLabel || "Subject")}</h3><p>${escapeHtml(selectedSubject.description || "Senza descrizione")}</p><form data-propose-selected-subject><label>Messaggio ai responsabili dell'inventario <small>facoltativo</small><textarea name="message" rows="3" maxlength="1000" placeholder="Spiega perché questo Subject dovrebbe entrare nell'inventario della sede"></textarea></label><p class="note">La proposta non modifica l'inventario e non colloca automaticamente l'entità sulla mappa.</p><div class="button-row"><button type="submit" ${busy ? "disabled" : ""}>Proponi</button><button class="button-secondary" type="button" data-reset-subject-selection>Cambia Subject</button></div></form></section>`;
    }
    return `<section class="venue-subject-selected"><h3>${escapeHtml(selectedSubject.preferredLabel || "Subject")}</h3><p>Il tuo ruolo non permette di aggiungere o proporre questo Subject all'inventario.</p><button class="button-secondary" type="button" data-reset-subject-selection>Cambia Subject</button></section>`;
  };

  const renderBrowser = () => {
    if (externalMode) return `<section class="venue-subject-external"><div class="section-heading compact"><div><span class="eyebrow">Ricerca estesa</span><h3>Cerca anche in Wikidata</h3><p>Usa una fonte esterna solo se il Subject non è già disponibile in ArtAround.</p></div><button class="button-secondary" type="button" data-close-external-subject-search>← Torna ai Subject ArtAround</button></div><artaround-semantic-entity-picker mode="subject" entity-kind="item" initial-query="${escapeHtml(query)}" ${query.length >= 2 ? "auto-search" : ""}></artaround-semantic-entity-picker></section>`;
    const results = candidates?.results || [];
    const canSearchExternal = Boolean(query && !(candidates?.exact || []).length);
    const org = results.filter((entry) => entry.source === "organization_content" || entry.tier <= 3);
    const others = results.filter((entry) => !org.includes(entry));
    const pagination = candidates?.pagination || {};
    const heading = query ? `Risultati per “${escapeHtml(query)}”` : "Dalla tua organizzazione";
    return `<form class="venue-subject-browser-search" data-subject-browser-search role="search"><label>Cerca un'opera, una persona o un luogo<input name="query" minlength="2" value="${escapeHtml(query)}" placeholder="Es. Gioconda, Leonardo, Sala del museo"></label><button type="submit" class="button-secondary" ${busy ? "disabled" : ""}>${busy ? "Ricerca…" : "Cerca"}</button>${query ? `<button class="button-secondary" type="button" data-clear-subject-search>Consigliati</button>` : ""}</form>${notice ? `<p class="status success" role="status">${escapeHtml(notice)}</p>` : ""}${error ? `<p role="alert">${escapeHtml(error)}</p>` : ""}${busy && !candidates ? `<p>Caricamento Subject…</p>` : `<section class="venue-subject-browser-group"><div class="section-heading compact"><div><span class="eyebrow">Subject</span><h3>${heading}</h3><p>${query ? "Prima i Subject già usati dall'organizzazione, poi gli altri risultati ArtAround." : "Sono suggeriti i Subject primari dei contenuti dell'organizzazione che non richiedono una ricerca manuale."}</p></div><span class="count">${Number(pagination.total || results.length)}</span></div>${org.length ? `<div class="venue-subject-browser-grid">${org.map(candidateCard).join("")}</div>` : ""}${others.length ? `<div class="venue-subject-browser-subgroup"><h4>Altri Subject ArtAround</h4><div class="venue-subject-browser-grid">${others.map(candidateCard).join("")}</div></div>` : ""}${!results.length && !busy ? `<div class="empty-state compact"><h4>${query ? "Nessun Subject ArtAround trovato" : "Nessun Subject suggerito"}</h4><p>${query ? "Puoi estendere la ricerca a Wikidata." : "Cerca un Subject per aggiungerlo o proporlo alla sede."}</p></div>` : ""}</section>${canSearchExternal ? `<button class="button-secondary" type="button" data-open-external-subject-search>Cerca anche in Wikidata</button>` : ""}${Number(pagination.totalPages || 0) > 1 ? `<nav class="pagination" aria-label="Pagine Subject"><button class="button-secondary" type="button" data-subject-page="${Math.max(1, Number(pagination.page || 1) - 1)}" ${Number(pagination.page || 1) <= 1 ? "disabled" : ""}>← Precedente</button><span>Pagina ${Number(pagination.page || 1)} di ${Number(pagination.totalPages || 1)}</span><button class="button-secondary" type="button" data-subject-page="${Number(pagination.page || 1) + 1}" ${Number(pagination.page || 1) >= Number(pagination.totalPages || 1) ? "disabled" : ""}>Successiva →</button></nav>` : ""}`}`;
  };

  const renderBody = () => `<style>
    .venue-subject-browser-search{display:grid;grid-template-columns:minmax(0,1fr) auto auto;gap:.55rem;align-items:end}.venue-subject-browser-search label{display:grid;gap:.35rem}.venue-subject-browser-group,.venue-subject-browser-subgroup,.venue-subject-selected,.venue-subject-external{display:grid;gap:.8rem}.venue-subject-browser-subgroup{margin-top:.45rem}.venue-subject-browser-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(17rem,1fr));gap:.65rem}.venue-subject-browser-card{display:grid;grid-template-columns:4.4rem minmax(0,1fr) auto;gap:.7rem;align-items:start;text-align:left;padding:.75rem;border:1px solid var(--line);border-radius:var(--radius-md);background:var(--surface);color:inherit}.venue-subject-browser-card:hover:not(.disabled){border-color:var(--sage-500);background:var(--sage-50)}.venue-subject-browser-card.disabled{cursor:default;opacity:.75}.venue-subject-browser-card img,.venue-subject-browser-placeholder{width:4.4rem;height:4.4rem;border-radius:.55rem;object-fit:cover;background:var(--sage-50)}.venue-subject-browser-placeholder{display:grid;place-items:center;font-size:1.6rem}.venue-subject-browser-copy{display:grid;gap:.18rem;min-width:0}.venue-subject-browser-copy small,.venue-subject-browser-copy>span{color:var(--sage-650)}.venue-subject-browser-copy small{display:-webkit-box;overflow:hidden;-webkit-box-orient:vertical;-webkit-line-clamp:2}.venue-subject-selected{padding:1rem;border:1px solid var(--sage-400);border-radius:var(--radius-md);background:var(--sage-50)}.venue-subject-selected h3,.venue-subject-selected p{margin:.15rem 0}.venue-subject-selected form{display:grid;gap:.65rem}.venue-subject-selected label{display:grid;gap:.35rem}.venue-subject-selected label small{font-weight:400;color:var(--sage-600)}@media(max-width:42rem){.venue-subject-browser-search{grid-template-columns:1fr}.venue-subject-browser-card{grid-template-columns:3.6rem minmax(0,1fr)}.venue-subject-browser-card .chip{grid-column:2}.venue-subject-browser-card img,.venue-subject-browser-placeholder{width:3.6rem;height:3.6rem}}
  </style>${selectedSubject ? renderSelected() : renderBrowser()}`;

  const refresh = () => controller?.render();
  controller = createTaskDialog({
    eyebrow: "Inventario della sede",
    title: "Aggiungi un Subject",
    description: "Scegli un Subject già utilizzato dalla tua organizzazione oppure cercalo in ArtAround. L'aggiunta all'inventario non assegna automaticamente una posizione sulla mappa.",
    size: "large",
    initialFocus: '[name="query"]',
    renderBody,
    renderFooter: () => `<button class="button-secondary" type="button" data-modal-dismiss ${busy ? "disabled" : ""}>Chiudi</button>`,
    isBusy: () => busy,
    onDismiss,
    onClick: async (event) => {
      const target = event.target instanceof Element ? event.target : null;
      if (!target) return;
      if (target.closest("[data-reset-subject-selection]")) { selectedSubject = null; error = null; notice = null; refresh(); return; }
      if (target.closest("[data-clear-subject-search]")) { query = ""; await loadCandidates({ resetPage: true }); return; }
      if (target.closest("[data-open-external-subject-search]")) { externalMode = true; selectedSubject = null; refresh(); return; }
      if (target.closest("[data-close-external-subject-search]")) { externalMode = false; refresh(); return; }
      const pageButton = target.closest("[data-subject-page]");
      if (pageButton) { page = Math.max(1, Number(pageButton.dataset.subjectPage) || 1); await loadCandidates(); return; }
      const use = target.closest("[data-use-venue-subject]");
      if (use) { selectSubject(candidateById(use.dataset.useVenueSubject)); return; }
      const withdraw = target.closest("[data-withdraw-selected-proposal]");
      if (withdraw && selectedSubject) {
        busy = true; error = null; refresh();
        try {
          await subjectPresenceRepository.withdrawProposal(venueId, withdraw.dataset.proposalId);
          notice = "Proposta ritirata.";
          onChanged?.({ action: "withdrawn", subjectId: id(selectedSubject) });
          candidates = await semanticRepository.searchVenueSubjects(venueId, query, { limit: 24, page }); selectedSubject = null;
        } catch (reason) { error = reason instanceof Error ? reason.message : "Proposta non ritirabile"; }
        finally { busy = false; refresh(); }
        return;
      }
      const accept = target.closest("[data-accept-selected-proposal]");
      if (accept && selectedSubject) {
        busy = true; error = null; refresh();
        try {
          await subjectPresenceRepository.acceptProposal(venueId, accept.dataset.proposalId);
          notice = "Proposta accettata: il Subject è ora nell'inventario, senza collocazione automatica.";
          onChanged?.({ action: "accepted", subjectId: id(selectedSubject) });
          query = ""; page = 1; candidates = await semanticRepository.searchVenueSubjects(venueId, "", { limit: 24, page: 1 }); selectedSubject = null;
        } catch (reason) { error = reason instanceof Error ? reason.message : "Proposta non accettabile"; }
        finally { busy = false; refresh(); }
      }
    },
    onSubmit: async (event) => {
      const form = event.target instanceof HTMLFormElement ? event.target : null;
      if (!form) return;
      if (form.matches("[data-subject-browser-search]")) {
        event.preventDefault(); query = String(new FormData(form).get("query") || "").trim(); await loadCandidates({ resetPage: true }); return;
      }
      if (!selectedSubject) return;
      if (form.matches("[data-add-selected-subject]")) {
        event.preventDefault(); const data = new FormData(form); busy = true; error = null; refresh();
        try {
          const result = await subjectPresenceRepository.addToInventory(venueId, {
            subjectId: id(selectedSubject),
            sourceItemId,
            displayLabelOverride: String(data.get("displayLabelOverride") || "").trim() || null,
            inventoryNote: String(data.get("inventoryNote") || "").trim() || null,
          });
          notice = "Subject aggiunto all'inventario della sede.";
          onChanged?.({ action: "added", subjectId: id(selectedSubject), target: result });
          query = ""; page = 1; candidates = await semanticRepository.searchVenueSubjects(venueId, "", { limit: 24, page: 1 }); selectedSubject = null;
        } catch (reason) { error = reason instanceof Error ? reason.message : "Non è stato possibile aggiungere il Subject"; }
        finally { busy = false; refresh(); }
        return;
      }
      if (form.matches("[data-propose-selected-subject]")) {
        event.preventDefault(); const data = new FormData(form); busy = true; error = null; refresh();
        try {
          await subjectPresenceRepository.propose(venueId, {
            subjectId: id(selectedSubject),
            sourceItemId,
            message: String(data.get("message") || "").trim() || null,
          });
          notice = "Proposta inviata ai responsabili dell'inventario.";
          onChanged?.({ action: "proposed", subjectId: id(selectedSubject) });
          query = ""; page = 1; candidates = await semanticRepository.searchVenueSubjects(venueId, "", { limit: 24, page: 1 }); selectedSubject = null;
        } catch (reason) { error = reason instanceof Error ? reason.message : "Non è stato possibile inviare la proposta"; }
        finally { busy = false; refresh(); }
      }
    },
  });

  controller.layer.addEventListener("subject-selected", async (event) => {
    if (!event.detail?.subject) return;
    const subject = event.detail.subject;
    const organizationId = candidates?.venue?.ownerOrganizationId || null;
    busy = true; error = null; notice = null; refresh();
    try {
      if (!organizationId) throw new Error("Contesto organizzazione non disponibile per verificare il Subject selezionato.");
      const presence = await subjectPresenceRepository.get(id(subject), { type: "organization", id: organizationId });
      const venuePresence = (presence?.organization?.venues || []).find((entry) => id(entry.venue?.id) === id(venueId)) || null;
      selectedSubject = {
        ...(presence?.subject || subject),
        source: "artaround",
        organizationUsage: presence?.organization?.usage || { itemCount: 0, availableCount: 0, draftCount: 0, collectionCount: 0, otherVenueCount: 0 },
        inventory: venuePresence?.inventory || null,
        proposal: venuePresence?.proposal || null,
        relationshipState: venuePresence?.relationshipState || "absent",
        availableOperations: venuePresence?.availableOperations || [],
      };
      if (selectedSubject.inventory?.venueTargetId) {
        notice = "Questo Subject è già presente nell'inventario della sede.";
        onExisting?.(selectedSubject.inventory.venueTargetId);
        selectedSubject = null;
      }
      externalMode = false;
    } catch (reason) {
      selectedSubject = null;
      error = reason instanceof Error ? reason.message : "Non è stato possibile verificare il Subject selezionato";
    } finally {
      busy = false;
      refresh();
    }
  });

  void loadCandidates({ resetPage: true });
  return controller;
}
