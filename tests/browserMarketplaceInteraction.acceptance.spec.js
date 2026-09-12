const { test, expect } = require("@playwright/test");

const BASE_URL = process.env.ARTAROUND_ACCEPTANCE_BASE_URL || "http://127.0.0.1:8000";
const VIEWPORTS = [
  { width: 320, height: 568 },
  { width: 390, height: 844 },
  { width: 844, height: 390 },
  { width: 768, height: 1024 },
  { width: 1024, height: 768 },
  { width: 1366, height: 768 },
  { width: 1440, height: 900 },
  { width: 1920, height: 1080 },
];

async function installTaskModal(page, { dirty = false } = {}) {
  await page.evaluate(async ({ dirty: startsDirty }) => {
    const { mountModalInteraction } = await import("/marketplace/src/application/modal-interaction.js");
    const { openActionDialog } = await import("/marketplace/src/ui/feedback-primitives.js");
    document.querySelector("#acceptance-task-modal")?.remove();
    document.querySelector("#acceptance-modal-origin")?.remove();

    const origin = document.createElement("button");
    origin.id = "acceptance-modal-origin";
    origin.textContent = "Apri task";
    document.body.append(origin);
    origin.focus();

    const layer = document.createElement("div");
    layer.id = "acceptance-task-modal";
    layer.className = "artaround-modal-layer";
    layer.dataset.modalBackdrop = "";
    layer.innerHTML = `
      <section class="artaround-task-modal artaround-task-modal--large" role="dialog" aria-modal="true" aria-labelledby="acceptance-task-title" tabindex="-1">
        <header class="artaround-task-modal__header">
          <div><span class="eyebrow">Acceptance</span><h2 id="acceptance-task-title">Task responsivo</h2><p>Verifica lifecycle e scrolling condivisi.</p></div>
          <button id="acceptance-modal-close" class="button-secondary artaround-task-modal__close" type="button" data-modal-dismiss aria-label="Chiudi">×</button>
        </header>
        <div class="artaround-task-modal__body">
          <label>Nome<input id="acceptance-modal-input" value="Bozza"></label>
          <div id="acceptance-long-content">${Array.from({ length: 70 }, (_, index) => `<p>Riga di contenuto ${index + 1}: testo abbastanza lungo da forzare lo scroll verticale interno senza creare overflow orizzontale.</p>`).join("")}</div>
        </div>
        <footer class="artaround-task-modal__footer">
          <button id="acceptance-modal-cancel" class="button-secondary" type="button" data-modal-dismiss>Annulla</button>
          <button id="acceptance-modal-confirm" type="button">Conferma</button>
        </footer>
      </section>`;
    document.body.append(layer);
    const panel = layer.querySelector(".artaround-task-modal");
    window.__acceptanceModal = { dirty: startsDirty, confirmCount: 0, dismissReason: null, controller: null };
    layer.querySelector("#acceptance-modal-confirm").addEventListener("click", () => { window.__acceptanceModal.confirmCount += 1; });

    const close = (reason) => {
      window.__acceptanceModal.dismissReason = reason;
      window.__acceptanceModal.controller?.release();
      layer.remove();
    };
    const controller = mountModalInteraction({
      layer,
      panel,
      initialFocus: "#acceptance-modal-cancel",
      canDismiss: () => true,
      onRequestDismiss: async (reason) => {
        if (window.__acceptanceModal.dirty) {
          const discard = await openActionDialog({
            title: "Scartare le modifiche?",
            message: "Le modifiche locali andranno perse.",
            confirmLabel: "Scarta modifiche",
            cancelLabel: "Continua a modificare",
            tone: "danger",
          });
          if (!discard) return;
        }
        close(reason);
      },
    });
    window.__acceptanceModal.controller = controller;
  }, { dirty });
}

async function geometry(page) {
  return page.evaluate(() => {
    const layer = document.querySelector("#acceptance-task-modal");
    const panel = layer?.querySelector(".artaround-task-modal");
    const body = layer?.querySelector(".artaround-task-modal__body");
    const info = (element, name) => {
      const style = getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      return {
        name,
        overflowY: style.overflowY,
        scrollable: element.scrollHeight > element.clientHeight + 1,
        rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
      };
    };
    return {
      viewport: { width: innerWidth, height: innerHeight },
      documentScrollWidth: document.documentElement.scrollWidth,
      pageScrollLocked: document.documentElement.classList.contains("artaround-layer-scroll-lock"),
      surfaces: [info(layer, "layer"), info(panel, "panel"), info(body, "body")],
    };
  });
}

test("Task Modal shell stays contained and owns exactly one vertical application scrollbar across target viewports", async ({ page }) => {
  await page.goto(`${BASE_URL}/marketplace/`, { waitUntil: "domcontentloaded" });
  for (const viewport of VIEWPORTS) {
    await page.setViewportSize(viewport);
    await installTaskModal(page);
    await expect(page.locator("#acceptance-modal-cancel")).toBeFocused();

    const result = await geometry(page);
    expect(result.pageScrollLocked).toBe(true);
    expect(result.documentScrollWidth).toBeLessThanOrEqual(result.viewport.width);
    for (const surface of result.surfaces) {
      expect(surface.rect.x).toBeGreaterThanOrEqual(-1);
      expect(surface.rect.y).toBeGreaterThanOrEqual(-1);
      expect(surface.rect.x + surface.rect.width).toBeLessThanOrEqual(result.viewport.width + 1);
      expect(surface.rect.y + surface.rect.height).toBeLessThanOrEqual(result.viewport.height + 1);
    }
    const scrollOwners = result.surfaces.filter((surface) => surface.scrollable && ["auto", "scroll"].includes(surface.overflowY));
    expect(scrollOwners.map((surface) => surface.name)).toEqual(["body"]);

    await page.locator("#acceptance-modal-confirm").focus();
    await page.keyboard.press("Tab");
    await expect(page.locator("#acceptance-modal-close")).toBeFocused();

    await page.keyboard.press("Escape");
    await expect(page.locator("#acceptance-task-modal")).toHaveCount(0);
    await expect(page.locator("#acceptance-modal-origin")).toBeFocused();
  }
});

test("Escape always chooses the non-destructive branch and dirty dismissal requires explicit discard", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`${BASE_URL}/marketplace/`, { waitUntil: "domcontentloaded" });
  await installTaskModal(page, { dirty: true });

  await page.keyboard.press("Escape");
  const actionDialog = page.locator("artaround-action-dialog:not([hidden])");
  await expect(actionDialog.getByRole("heading", { name: "Scartare le modifiche?" })).toBeVisible();
  await expect(actionDialog.locator("[data-dialog-cancel]")).toBeFocused();

  await page.keyboard.press("Escape");
  await expect(actionDialog).toHaveCount(0);
  await expect(page.locator("#acceptance-task-modal")).toBeVisible();
  expect(await page.evaluate(() => window.__acceptanceModal.confirmCount)).toBe(0);

  await page.keyboard.press("Escape");
  await expect(actionDialog.getByRole("heading", { name: "Scartare le modifiche?" })).toBeVisible();
  await actionDialog.locator("[data-dialog-confirm]").click();
  await expect(page.locator("#acceptance-task-modal")).toHaveCount(0);
  await expect(page.locator("#acceptance-modal-origin")).toBeFocused();
  const outcome = await page.evaluate(() => ({
    reason: window.__acceptanceModal.dismissReason,
    confirmCount: window.__acceptanceModal.confirmCount,
  }));
  expect(outcome.reason).toBe("escape");
  expect(outcome.confirmCount).toBe(0);
});

test("backdrop and explicit cancel use the same dismiss contract", async ({ page }) => {
  await page.setViewportSize({ width: 1024, height: 768 });
  await page.goto(`${BASE_URL}/marketplace/`, { waitUntil: "domcontentloaded" });

  await installTaskModal(page);
  await page.locator("#acceptance-modal-cancel").click();
  expect(await page.evaluate(() => window.__acceptanceModal.dismissReason)).toBe("dismiss");
  await expect(page.locator("#acceptance-task-modal")).toHaveCount(0);

  await installTaskModal(page);
  await page.locator("#acceptance-task-modal").click({ position: { x: 3, y: 3 } });
  expect(await page.evaluate(() => window.__acceptanceModal.dismissReason)).toBe("backdrop");
  await expect(page.locator("#acceptance-task-modal")).toHaveCount(0);
});
