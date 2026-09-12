import { marketplaceRepository } from "../infrastructure/http/marketplace-repository.js";
import { icon } from "./icons.js";
import { createTaskDialog } from "./task-dialog.js";

function escapeHtml(value = "") {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}
function priceInMinorUnits(value) {
  const normalized = String(value || "").trim().replace(",", ".");
  if (!/^\d+(?:\.\d{1,2})?$/.test(normalized)) return null;
  const amount = Number(normalized);
  return Number.isSafeInteger(Math.round(amount * 100)) ? Math.round(amount * 100) : null;
}

export function openOfferCreateDialog({ listing, onCreated = null, onDismiss = null } = {}) {
  if (!listing) return null;
  const config = listing.offerConfiguration || {};
  const firstCapability = config.capabilityOptions?.[0]?.code;
  const state = {
    step: "conditions",
    label: "",
    pricingType: "free",
    amount: "",
    currency: config.defaultCurrency || "EUR",
    versionPolicy: config.versionPolicyOptions?.[0]?.code || "",
    capabilities: new Set(firstCapability ? [firstCapability] : []),
    dirty: false,
    busy: false,
    error: null,
  };
  let dialog = null;
  const conditionsForm = `offer-conditions-${listing.id}`;
  const rightsForm = `offer-rights-${listing.id}`;

  const stepper = () => `<ol class="collection-create-stepper" aria-label="Creazione offerta"><li class="${state.step === "conditions" ? "is-current" : "is-complete"}" ${state.step === "conditions" ? 'aria-current="step"' : ""}><span>${state.step === "conditions" ? "1" : "✓"}</span><strong>Condizioni</strong></li><li class="${state.step === "rights" ? "is-current" : ""}" ${state.step === "rights" ? 'aria-current="step"' : ""}><span>2</span><strong>Diritti</strong></li></ol>`;

  const conditions = () => `<form id="${conditionsForm}" data-offer-conditions><div class="form-grid"><label class="wide">Nome dell’offerta<input name="label" required maxlength="120" placeholder="Es. Accesso completo alla visita" value="${escapeHtml(state.label)}"></label><label>Prezzo<select name="pricingType"><option value="free" ${state.pricingType === "free" ? "selected" : ""}>Gratuita</option><option value="paid" ${state.pricingType === "paid" ? "selected" : ""}>A pagamento</option></select></label><label>Aggiornamenti inclusi<select name="versionPolicy" required>${(config.versionPolicyOptions || []).map((entry) => `<option value="${escapeHtml(entry.code)}" ${entry.code === state.versionPolicy ? "selected" : ""}>${escapeHtml(entry.label)}</option>`).join("")}</select></label></div>${state.pricingType === "paid" ? `<div class="seller-paid-fields"><label>Importo<input name="amount" inputmode="decimal" placeholder="4,99" value="${escapeHtml(state.amount)}" required></label><label>Valuta<input name="currency" value="${escapeHtml(state.currency)}" maxlength="3" required></label></div>` : ""}<p class="license-history-note">Le condizioni pubblicate non modificano le acquisizioni passate. Per condizioni diverse pubblica una nuova offerta.</p></form>`;

  const rights = () => `<form id="${rightsForm}" data-offer-rights><fieldset class="seller-rights-fieldset"><legend>Diritti concessi</legend><p>Seleziona cosa potrà fare chi acquisisce questa offerta.</p>${(config.capabilityOptions || []).map((entry) => `<label class="seller-right-choice"><input type="checkbox" name="capability" value="${escapeHtml(entry.code)}" ${state.capabilities.has(entry.code) ? "checked" : ""}><span><strong>${escapeHtml(entry.label)}</strong><small>Concedi questo diritto con l’offerta.</small></span></label>`).join("")}</fieldset><details class="technical-details"><summary>Codici tecnici dei diritti</summary><ul class="technical-grants">${(config.capabilityOptions || []).map((entry) => `<li>${escapeHtml(entry.label)} · <code>${escapeHtml(entry.code)}</code></li>`).join("")}</ul></details></form>`;

  const body = () => `${stepper()}${state.error ? `<artaround-callout tone="danger" role="alert">${escapeHtml(state.error)}</artaround-callout>` : ""}${state.step === "rights" ? rights() : conditions()}`;
  const footer = () => state.step === "rights"
    ? `<button type="button" class="button-secondary" data-offer-back ${state.busy ? "disabled" : ""}>← Indietro</button><button type="submit" form="${rightsForm}" ${state.busy ? "disabled" : ""}>${icon("store", { size: 16 })} ${state.busy ? "Pubblicazione…" : "Pubblica offerta"}</button>`
    : `<button type="button" class="button-secondary" data-modal-dismiss>Annulla</button><button type="submit" form="${conditionsForm}">Continua ${icon("chevron", { size: 15 })}</button>`;

  const captureConditions = (form) => {
    const data = new FormData(form);
    state.label = String(data.get("label") || "");
    state.pricingType = String(data.get("pricingType") || "free");
    state.versionPolicy = String(data.get("versionPolicy") || "");
    state.amount = String(data.get("amount") || state.amount);
    state.currency = String(data.get("currency") || state.currency);
  };

  async function publish(form) {
    const data = new FormData(form);
    state.capabilities = new Set(data.getAll("capability").map(String).filter(Boolean));
    if (!state.capabilities.size) {
      state.error = "Seleziona almeno un diritto da concedere.";
      dialog?.render();
      return;
    }
    let pricing = { type: "free" };
    if (state.pricingType === "paid") {
      const amountMinor = priceInMinorUnits(state.amount);
      const currency = state.currency.trim().toUpperCase();
      if (amountMinor === null || amountMinor <= 0) {
        state.step = "conditions";
        state.error = "Inserisci un prezzo maggiore di zero, con al massimo due decimali.";
        dialog?.render();
        return;
      }
      if (!/^[A-Z]{3}$/.test(currency)) {
        state.step = "conditions";
        state.error = "La valuta deve essere un codice ISO di tre lettere, ad esempio EUR.";
        dialog?.render();
        return;
      }
      pricing = { type: "paid", amountMinor, currency };
    }
    const resource = config.resourceRef;
    if (!resource?.resourceType || !resource?.resourceId) {
      state.error = "La risorsa dell'offerta non è disponibile.";
      dialog?.render();
      return;
    }
    state.busy = true;
    state.error = null;
    dialog?.render();
    try {
      const payload = {
        label: state.label.trim(),
        pricing,
        grants: [...state.capabilities].map((capability) => ({
          resourceType: resource.resourceType,
          resourceId: resource.resourceId,
          capability,
          versionPolicy: state.versionPolicy,
        })),
      };
      const result = await marketplaceRepository.createOffer(listing.id, payload);
      state.dirty = false;
      dialog?.close({ notify: false });
      dialog = null;
      onCreated?.(result);
    } catch (error) {
      state.error = error instanceof Error ? error.message : "Offerta non pubblicata";
      state.busy = false;
      dialog?.render();
    }
  }

  dialog = createTaskDialog({
    eyebrow: "Nuova offerta",
    title: listing.asset?.title || "Configura offerta",
    description: "Definisci prima condizioni e aggiornamenti, poi i diritti concessi all'acquirente.",
    size: "large",
    initialFocus: "input[name='label']",
    renderBody: body,
    renderFooter: footer,
    isBusy: () => state.busy,
    isDirty: () => state.dirty,
    onDiscard: () => { state.dirty = false; },
    onDismiss: (reason) => { dialog = null; onDismiss?.(reason); },
    onClick: (event) => {
      if (event.target instanceof Element && event.target.closest("[data-offer-back]")) {
        state.step = "conditions";
        state.error = null;
        dialog?.render();
        dialog?.focus("input[name='label']");
      }
    },
    onInput: (event) => {
      const field = event.target instanceof HTMLInputElement ? event.target : null;
      if (!field) return;
      if (field.name === "label") state.label = field.value;
      if (field.name === "amount") state.amount = field.value;
      if (field.name === "currency") state.currency = field.value;
      state.dirty = true;
    },
    onChange: (event) => {
      const field = event.target instanceof HTMLInputElement || event.target instanceof HTMLSelectElement ? event.target : null;
      if (!field) return;
      if (field.name === "pricingType") {
        state.pricingType = field.value;
        state.dirty = true;
        dialog?.render();
        dialog?.focus("select[name='pricingType']");
        return;
      }
      if (field.name === "versionPolicy") state.versionPolicy = field.value;
      if (field.name === "capability") {
        if (field.checked) state.capabilities.add(field.value); else state.capabilities.delete(field.value);
      }
      state.dirty = true;
    },
    onSubmit: (event) => {
      const form = event.target instanceof HTMLFormElement ? event.target : null;
      if (form?.matches("[data-offer-conditions]")) {
        event.preventDefault();
        captureConditions(form);
        if (!form.reportValidity()) return;
        if (state.pricingType === "paid") {
          const amountMinor = priceInMinorUnits(state.amount);
          if (amountMinor === null || amountMinor <= 0) {
            state.error = "Inserisci un prezzo maggiore di zero, con al massimo due decimali.";
            dialog?.render();
            return;
          }
        }
        state.error = null;
        state.step = "rights";
        dialog?.render();
        dialog?.focus("input[name='capability']");
        return;
      }
      if (form?.matches("[data-offer-rights]")) {
        event.preventDefault();
        void publish(form);
      }
    },
  });
  return dialog;
}
