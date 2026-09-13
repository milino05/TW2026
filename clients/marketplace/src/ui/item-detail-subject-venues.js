import "./item-detail-dialog.js";
import { operatingPrincipal, readOperatingContext } from "../application/operating-context.js";
import "./subject-presence.js";

function id(value) { return String(value?._id || value?.id || value || ""); }

export function installItemDetailSubjectVenueIntegration(ItemDetailDialog) {
  if (!ItemDetailDialog || ItemDetailDialog.__subjectVenueIntegrationInstalled) return;
  ItemDetailDialog.__subjectVenueIntegrationInstalled = true;
  const prototype = ItemDetailDialog.prototype;
  const baseConnected = prototype.connectedCallback;
  const baseRender = prototype.render;
  const baseRenderBody = prototype.renderBody;
  const baseRenderTabs = prototype.renderTabs;

  prototype.connectedCallback = function connectedWithSubjectVenues(...args) {
    this.context = readOperatingContext();
    this.principal = operatingPrincipal(this.context);
    baseConnected.apply(this, args);
  };

  prototype.renderVenues = function renderVenues() {
    if (this.principal?.type !== "organization") {
      return `<section class="item-detail-section"><div class="empty-state compact"><p>Seleziona un'area di lavoro organizzazione per gestire la presenza del Subject nelle sedi.</p></div></section>`;
    }
    return `<section class="item-detail-section"><div class="section-heading"><div><span class="eyebrow">Sedi</span><h2>Presenza del Subject nelle sedi</h2><p>Inventario fisico e contenuto editoriale restano separati: qui puoi aggiungere il Subject, proporlo o consultarne la collocazione.</p></div></div><artaround-subject-presence data-item-detail-subject-presence></artaround-subject-presence></section>`;
  };

  prototype.configureSubjectVenueSurface = function configureSubjectVenueSurface() {
    const surface = this.querySelector("artaround-subject-presence[data-item-detail-subject-presence]");
    if (!surface || !this.data?.subject || this.principal?.type !== "organization") return;
    surface.configure({ subjectId: id(this.data.subject), sourceItemId: this.itemId, principal: this.principal });
  };

  prototype.renderTabs = function renderTabsWithVenues() {
    const base = baseRenderTabs.call(this);
    if (this.principal?.type !== "organization") return base;
    return base.replace("</nav>", `<button type="button" data-item-detail-tab="venues" aria-current="${this.tab === "venues" ? "page" : "false"}">Sedi</button></nav>`);
  };

  prototype.renderBody = function renderBodyWithVenues() {
    if (this.view === "tabs" && this.tab === "venues") return `${this.renderTabs()}${this.renderVenues()}`;
    return baseRenderBody.call(this);
  };

  prototype.render = function renderWithSubjectVenues(...args) {
    const result = baseRender.apply(this, args);
    queueMicrotask(() => this.configureSubjectVenueSurface());
    return result;
  };
}

installItemDetailSubjectVenueIntegration(customElements.get("artaround-item-detail-dialog"));
