import { navigatorConfigRepository } from "../infrastructure/http/navigator-config-repository.js";
import { notify } from "../application/ui-feedback.js";
import { replaceCurrentHistoryUrl } from "../application/router.js";
import { venueActionMixin } from "./venue-editor-action-mixin.js";
import { venueMapRefinementMixin } from "./venue-editor-map-refinement-mixin.js";

function escapeHtml(value = "") {
  return String(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#039;");
}

function assetPreviewUrl(venueId, asset) {
  if (!asset) return "";
  if (asset.assetId) return `/api/navigator-assets/${encodeURIComponent(asset.assetId)}`;
  if (asset.src) return `/navigator-configs/${encodeURIComponent(venueId)}${asset.src}`;
  return "";
}

function configurableAsset(asset, alt) {
  if (!asset?.assetId) return undefined;
  return { assetId: asset.assetId, alt: String(alt ?? asset.alt ?? "") };
}

function fileAsBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("Impossibile leggere il file selezionato"));
    reader.onload = () => resolve(String(reader.result || "").split(",").pop() || "");
    reader.readAsDataURL(file);
  });
}

function downloadJson(filename, value) {
  const blob = new Blob([`${JSON.stringify(value, null, 2)}\n`], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

function configFromForm(view, data) {
  const current = view.navigatorConfig?.config || {};
  const currentBranding = current.branding || {};
  const logo = configurableAsset(currentBranding.logo, data.get("logoAlt"));
  const heroImage = configurableAsset(currentBranding.heroImage, data.get("heroAlt"));
  return {
    schemaVersion: 3,
    venueId: view.id,
    branding: {
      productTitle: String(data.get("productTitle") || currentBranding.productTitle || "ArtAround").trim(),
      museumTitle: String(data.get("museumTitle") || "").trim(),
      subtitle: String(data.get("subtitle") || ""),
      ...(logo ? { logo } : {}),
      ...(heroImage ? { heroImage } : {}),
      theme: {
        primary: String(data.get("primary") || ""),
        accent: String(data.get("accent") || ""),
        surface: String(data.get("surface") || ""),
      },
    },
  };
}

export const venueNavigatorMixin = {
  navigatorConfig: null,
  navigatorConfigLoading: false,
  navigatorConfigError: null,

  render(...args) {
    const result = venueMapRefinementMixin.render.apply(this, args);
    this.decorateNavigatorWorkspace();
    return result;
  },

  syncSectionNavigation({ scroll = false } = {}) {
    if (this.onboarding?.required) return;
    const tabs = [...this.querySelectorAll("[data-venue-section]")];
    const available = tabs.map((tab) => tab.dataset.venueSection).filter(Boolean);
    const navigatorPending = this.activeSection === "navigator" && !available.includes("navigator");
    if (!available.includes(this.activeSection) && !navigatorPending) this.activeSection = available[0] || "overview";
    for (const tab of tabs) {
      const selected = tab.dataset.venueSection === this.activeSection;
      tab.setAttribute("aria-selected", String(selected));
      tab.tabIndex = selected ? 0 : -1;
    }
    for (const panel of this.querySelectorAll(".venue-section")) {
      const selected = panel.id === `venue-${this.activeSection}`;
      panel.hidden = !selected;
      panel.setAttribute("role", "tabpanel");
      panel.setAttribute("aria-labelledby", `venue-tab-${panel.id.replace("venue-", "")}`);
      panel.tabIndex = -1;
    }
    const panel = this.querySelector(`#venue-${this.activeSection}`);
    if (scroll && panel) panel.scrollIntoView({ behavior: "smooth", block: "start" });
  },

  showSection(section, { scroll = false } = {}) {
    if (!this.querySelector(`[data-venue-section="${CSS.escape(String(section || ""))}"]`)) return;
    this.activeSection = section;
    replaceCurrentHistoryUrl(`${window.location.pathname}${window.location.search}#venue-${section}`);
    this.syncSectionNavigation({ scroll });
  },

  decorateNavigatorWorkspace() {
    if (!this.data || this.onboarding?.required) return;
    const tabs = this.querySelector(".venue-editor-tabs");
    const content = this.querySelector(".venue-editor-content");
    if (!tabs || !content) return;
    if (!tabs.querySelector('[data-venue-section="navigator"]')) {
      const button = document.createElement("button");
      button.type = "button";
      button.id = "venue-tab-navigator";
      button.setAttribute("role", "tab");
      button.dataset.venueSection = "navigator";
      button.setAttribute("aria-controls", "venue-navigator");
      button.textContent = "Navigator";
      const publication = tabs.querySelector('[data-venue-section="publication"]');
      tabs.insertBefore(button, publication || null);
    }
    if (!content.querySelector("#venue-navigator")) {
      const template = document.createElement("template");
      template.innerHTML = this.renderNavigator().trim();
      const panel = template.content.firstElementChild;
      const publication = content.querySelector("#venue-publication");
      if (panel) content.insertBefore(panel, publication || null);
    }
    this.syncSectionNavigation();
  },

  async onClick(event) {
    if (await this.handleNavigatorClick(event)) return;
    return venueActionMixin.onClick.call(this, event);
  },

  async onSubmit(event) {
    const form = event.target instanceof HTMLFormElement ? event.target : null;
    if (form && form.matches("[data-navigator-config],[data-navigator-asset-upload],[data-navigator-copy],[data-navigator-import]")) {
      event.preventDefault();
      if (await this.handleNavigatorSubmit(form, new FormData(form))) return;
    }
    return venueActionMixin.onSubmit.call(this, event);
  },

  async loadNavigatorConfig() {
    if (this.navigatorConfigLoading) return;
    this.navigatorConfigLoading = true;
    this.navigatorConfigError = null;
    try {
      this.navigatorConfig = await navigatorConfigRepository.get(this.id);
    } catch (error) {
      this.navigatorConfigError = error instanceof Error ? error.message : "Configurazione Navigator non disponibile";
    } finally {
      this.navigatorConfigLoading = false;
      this.render();
    }
  },

  renderNavigator() {
    if (!this.navigatorConfig && !this.navigatorConfigLoading && !this.navigatorConfigError) {
      queueMicrotask(() => this.loadNavigatorConfig());
    }
    if (this.navigatorConfigLoading && !this.navigatorConfig) {
      return `<section class="venue-section" id="venue-navigator"><div class="section-heading"><div><span class="eyebrow">Navigator</span><h2>Identità del museo</h2><p>Caricamento configurazione…</p></div></div></section>`;
    }
    if (this.navigatorConfigError && !this.navigatorConfig) {
      return `<section class="venue-section" id="venue-navigator"><div class="section-heading"><div><span class="eyebrow">Navigator</span><h2>Identità del museo</h2><p role="alert">${escapeHtml(this.navigatorConfigError)}</p></div></div><button type="button" data-navigator-retry>Riprova</button></section>`;
    }

    const projection = this.navigatorConfig || {};
    const config = projection.config || {};
    const branding = config.branding || {};
    const theme = branding.theme || {};
    const logoUrl = assetPreviewUrl(this.id, branding.logo);
    const heroUrl = assetPreviewUrl(this.id, branding.heroImage);
    const disabled = projection.canManage ? "" : "disabled";
    const sourceOptions = (projection.copySources || []).map((venue) => `<option value="${escapeHtml(venue.id)}">${escapeHtml(venue.name)}</option>`).join("");
    const legacyNote = projection.legacy
      ? `<p class="note">Questa sede usa ancora la configurazione v2. Il primo salvataggio o copia importerà automaticamente logo e hero nel database e convertirà il file in v3.</p>`
      : "";

    return `<section class="venue-section" id="venue-navigator">
      <div class="section-heading"><div><span class="eyebrow">Navigator</span><h2>Configurazione del Navigator</h2><p>Questi dati personalizzano il Navigator per questa sede. Il file JSON resta la fonte di configurazione; logo e immagini usano asset stabili condivisibili tra sedi della stessa organizzazione.</p></div></div>
      ${legacyNote}
      <div class="panel">
        <div class="venue-navigator-preview">
          ${heroUrl ? `<img src="${escapeHtml(heroUrl)}" alt="${escapeHtml(branding.heroImage?.alt || "")}" style="max-width:100%;max-height:220px;object-fit:cover;border-radius:12px">` : ""}
          <div style="display:flex;align-items:center;gap:12px;margin-top:12px">${logoUrl ? `<img src="${escapeHtml(logoUrl)}" alt="" width="56" height="56" style="object-fit:contain">` : ""}<div><strong>${escapeHtml(branding.museumTitle || this.data?.venue?.name || "Museo")}</strong><p class="note">${escapeHtml(branding.subtitle || "")}</p></div></div>
        </div>
      </div>
      <form data-navigator-config class="venue-overview-form">
        <label>Prodotto<input name="productTitle" value="${escapeHtml(branding.productTitle || "ArtAround")}" required ${disabled}></label>
        <label>Nome nel Navigator<input name="museumTitle" value="${escapeHtml(branding.museumTitle || this.data?.venue?.name || "")}" required ${disabled}></label>
        <label class="wide">Sottotitolo<input name="subtitle" value="${escapeHtml(branding.subtitle || "")}" ${disabled}></label>
        <label>Colore primario<input name="primary" type="color" value="${escapeHtml(theme.primary || "#8D4050")}" ${disabled}></label>
        <label>Colore accento<input name="accent" type="color" value="${escapeHtml(theme.accent || "#B78B52")}" ${disabled}></label>
        <label>Colore superficie<input name="surface" type="color" value="${escapeHtml(theme.surface || "#F6F1E8")}" ${disabled}></label>
        <label class="wide">Testo alternativo logo<input name="logoAlt" value="${escapeHtml(branding.logo?.alt || "")}" ${disabled}></label>
        <label class="wide">Testo alternativo hero<input name="heroAlt" value="${escapeHtml(branding.heroImage?.alt || "")}" ${disabled}></label>
        ${projection.canManage ? `<button type="submit">Salva configurazione</button>` : `<p class="note wide">Hai accesso in sola lettura alla configurazione Navigator.</p>`}
      </form>
      ${projection.canManage ? `<div class="panel"><h3>Logo e immagine principale</h3>
        <form data-navigator-asset-upload="logo"><label>Nuovo logo<input type="file" name="file" accept="image/jpeg,image/png,image/webp,image/avif" required></label><button type="submit">Carica logo</button>${branding.logo ? `<button type="button" class="button-secondary" data-navigator-clear="logo">Rimuovi logo</button>` : ""}</form>
        <form data-navigator-asset-upload="heroImage"><label>Nuova immagine principale<input type="file" name="file" accept="image/jpeg,image/png,image/webp,image/avif" required></label><button type="submit">Carica hero</button>${branding.heroImage ? `<button type="button" class="button-secondary" data-navigator-clear="heroImage">Rimuovi hero</button>` : ""}</form>
      </div>
      <div class="panel"><h3>Riutilizza configurazione</h3>
        ${sourceOptions ? `<form data-navigator-copy><label>Copia da un'altra sede<select name="sourceVenueId" required><option value="">Seleziona una sede</option>${sourceOptions}</select></label><button type="submit">Copia configurazione</button></form>` : `<p class="note">Non ci sono altre sedi attive da cui copiare.</p>`}
        <form data-navigator-import><label>Importa JSON<input type="file" name="configFile" accept="application/json,.json" required></label><button type="submit">Importa configurazione</button></form>
        <button type="button" class="button-secondary" data-navigator-export>Esporta JSON</button>
      </div>` : `<div class="panel"><button type="button" class="button-secondary" data-navigator-export>Esporta JSON</button></div>`}
    </section>`;
  },

  async handleNavigatorClick(event) {
    const target = event.target instanceof Element ? event.target : null;
    if (!target) return false;
    if (target.closest("[data-navigator-retry]")) {
      this.navigatorConfigError = null;
      await this.loadNavigatorConfig();
      return true;
    }
    const clear = target.closest("[data-navigator-clear]");
    if (clear) {
      const role = clear.dataset.navigatorClear;
      const config = structuredClone(this.navigatorConfig?.config || {});
      if (config.branding) config.branding[role] = null;
      try {
        const result = await navigatorConfigRepository.update(this.id, config);
        this.navigatorConfig = { ...this.navigatorConfig, exists: true, legacy: false, config: result.config };
        notify.success(role === "logo" ? "Logo rimosso." : "Immagine principale rimossa.");
        this.render();
      } catch (error) { notify.danger(error instanceof Error ? error.message : "Operazione non riuscita"); }
      return true;
    }
    if (target.closest("[data-navigator-export]")) {
      try {
        if (this.navigatorConfig?.legacy && this.navigatorConfig?.canManage) {
          const migrated = await navigatorConfigRepository.update(this.id, this.navigatorConfig.config);
          this.navigatorConfig = { ...this.navigatorConfig, exists: true, legacy: false, config: migrated.config };
        }
        const config = this.navigatorConfig?.config;
        if (!config) throw new Error("Configurazione Navigator non disponibile");
        downloadJson(`navigator-${this.id}.json`, config);
      } catch (error) { notify.danger(error instanceof Error ? error.message : "Esportazione non riuscita"); }
      return true;
    }
    return false;
  },

  async handleNavigatorSubmit(form, data) {
    if (form.matches("[data-navigator-config]")) {
      try {
        let requested = configFromForm(this, data);
        let result = await navigatorConfigRepository.update(this.id, requested);
        if (this.navigatorConfig?.legacy) {
          requested = configFromForm({ ...this, navigatorConfig: { ...this.navigatorConfig, config: result.config } }, data);
          result = await navigatorConfigRepository.update(this.id, requested);
        }
        this.navigatorConfig = { ...this.navigatorConfig, exists: true, legacy: false, config: result.config };
        notify.success("Configurazione Navigator aggiornata.");
        this.render();
      } catch (error) { notify.danger(error instanceof Error ? error.message : "Salvataggio non riuscito"); }
      return true;
    }

    if (form.matches("[data-navigator-asset-upload]")) {
      const file = data.get("file");
      if (!(file instanceof File) || !file.size) return true;
      const role = form.dataset.navigatorAssetUpload;
      try {
        const dataBase64 = await fileAsBase64(file);
        const uploaded = await navigatorConfigRepository.uploadAsset(this.id, { fileName: file.name, mimeType: file.type, dataBase64 });
        const config = structuredClone(this.navigatorConfig?.config || {});
        const branding = config.branding || {};
        const existingAlt = String(branding?.[role]?.alt || "");
        branding[role] = { assetId: uploaded.asset.id, alt: existingAlt };
        config.branding = branding;
        const result = await navigatorConfigRepository.update(this.id, config);
        this.navigatorConfig = { ...this.navigatorConfig, exists: true, legacy: false, config: result.config };
        notify.success(role === "logo" ? "Logo aggiornato." : "Immagine principale aggiornata.");
        this.render();
      } catch (error) { notify.danger(error instanceof Error ? error.message : "Caricamento non riuscito"); }
      return true;
    }

    if (form.matches("[data-navigator-copy]")) {
      const sourceVenueId = String(data.get("sourceVenueId") || "");
      if (!sourceVenueId) return true;
      try {
        const result = await navigatorConfigRepository.copy(this.id, sourceVenueId);
        this.navigatorConfig = { ...this.navigatorConfig, exists: true, legacy: false, config: result.config };
        notify.success("Configurazione copiata dalla sede selezionata.");
        this.render();
      } catch (error) { notify.danger(error instanceof Error ? error.message : "Copia non riuscita"); }
      return true;
    }

    if (form.matches("[data-navigator-import]")) {
      const file = data.get("configFile");
      if (!(file instanceof File) || !file.size) return true;
      try {
        const imported = JSON.parse(await file.text());
        const result = await navigatorConfigRepository.update(this.id, imported);
        this.navigatorConfig = { ...this.navigatorConfig, exists: true, legacy: false, config: result.config };
        notify.success("Configurazione JSON importata. La sede di destinazione è stata mantenuta.");
        this.render();
      } catch (error) { notify.danger(error instanceof Error ? error.message : "Importazione non riuscita"); }
      return true;
    }
    return false;
  },
};
