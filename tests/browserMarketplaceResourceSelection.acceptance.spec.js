const { test, expect } = require("@playwright/test");

const BASE_URL = process.env.ARTAROUND_ACCEPTANCE_BASE_URL || "http://127.0.0.1:8000";

test("editorial space selection keeps the search field stable while filtering", async ({ page }) => {
  await page.goto(`${BASE_URL}/marketplace/`, { waitUntil: "domcontentloaded" });

  await page.evaluate(async () => {
    const { openSpaceSelectionDialog } = await import("/marketplace/src/ui/workspace-space-dialogs.js");
    window.__spaceSelectionAcceptance = { chosen: null };
    openSpaceSelectionDialog({
      spaces: [
        { id: "space-a", name: "Collezione permanente", description: "Corpus principale", stats: { collectionCount: 4, itemCount: 18 } },
        { id: "space-b", name: "Mostra temporanea", description: "Corpus della mostra", stats: { collectionCount: 2, itemCount: 7 } },
        { id: "space-c", name: "Didattica", description: "Percorsi per le scuole", stats: { collectionCount: 1, itemCount: 5 } },
      ],
      currentSpace: { id: "space-a" },
      canCreate: true,
      onChoose: (space) => { window.__spaceSelectionAcceptance.chosen = space.id; },
    });
  });

  const modal = page.locator('.artaround-modal-layer[data-artaround-layer="modal"]');
  await expect(modal.getByRole("heading", { name: "Scegli dove lavorare" })).toBeVisible();
  await expect(modal.getByText("Spazio corrente", { exact: true })).toBeVisible();
  await expect(modal.getByText("Altri spazi", { exact: true })).toBeVisible();
  await expect(modal.locator('[data-choose-space="space-a"]')).toHaveAttribute("aria-current", "true");

  const search = modal.locator('input[name="spaceQuery"]');
  await expect(search).toBeFocused();
  await search.evaluate((node) => { node.dataset.acceptanceIdentity = "stable"; });
  await search.fill("mostra");
  await expect(search).toHaveAttribute("data-acceptance-identity", "stable");
  await expect(search).toBeFocused();
  await expect(modal.locator("[data-choose-space]")).toHaveCount(1);
  await expect(modal.locator('[data-choose-space="space-b"]')).toBeVisible();

  await modal.locator('[data-choose-space="space-b"]').click();
  await expect(modal).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => window.__spaceSelectionAcceptance.chosen)).toBe("space-b");
});

test("modal staging layers stay invisible until LayerManager portals them", async ({ page }) => {
  await page.goto(`${BASE_URL}/marketplace/`, { waitUntil: "domcontentloaded" });

  const state = await page.evaluate(async () => {
    const { mountModalInteraction } = await import("/marketplace/src/application/modal-interaction.js");
    const host = document.createElement("artaround-modal-staging-acceptance");
    host.innerHTML = `<div class="artaround-modal-layer" data-modal-backdrop="true"><section class="artaround-task-modal" role="dialog" aria-modal="true" aria-label="Staging acceptance"><div class="artaround-task-modal__body"><button type="button">Azione</button></div></section></div>`;
    document.body.append(host);
    const layer = host.querySelector(".artaround-modal-layer");
    const before = {
      visibility: getComputedStyle(layer).visibility,
      parent: layer.parentElement.tagName,
    };
    const controller = mountModalInteraction({
      layer,
      panel: () => layer.querySelector(".artaround-task-modal"),
    });
    const mounted = {
      visibility: getComputedStyle(layer).visibility,
      parent: layer.parentElement.tagName,
      kind: layer.dataset.artaroundLayer,
    };
    controller.release({ restoreFocus: true });
    const released = {
      visibility: getComputedStyle(layer).visibility,
      parent: layer.parentElement.tagName,
      kind: layer.dataset.artaroundLayer || null,
    };
    host.remove();
    return { before, mounted, released };
  });

  expect(state.before).toEqual({ visibility: "hidden", parent: "ARTAROUND-MODAL-STAGING-ACCEPTANCE" });
  expect(state.mounted).toEqual({ visibility: "visible", parent: "BODY", kind: "modal" });
  expect(state.released).toEqual({ visibility: "hidden", parent: "ARTAROUND-MODAL-STAGING-ACCEPTANCE", kind: null });
});

test("large Item Detail keeps the same panel geometry from loading to loaded content", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`${BASE_URL}/marketplace/`, { waitUntil: "domcontentloaded" });

  await page.evaluate(async () => {
    const { libraryRepository } = await import("/marketplace/src/infrastructure/http/library-repository.js");
    let resolveDetail;
    libraryRepository.itemDetail = () => new Promise((resolve) => { resolveDetail = resolve; });
    window.__resolveItemDetailAcceptance = () => resolveDetail({
      subject: {
        id: "subject-acceptance",
        preferredLabel: "Opera acceptance",
        description: "Descrizione usata per verificare che il contenuto asincrono non ridimensioni il pannello.",
      },
      item: { id: "item-acceptance", recognitionMedia: null },
      space: { id: "space-acceptance", name: "Spazio acceptance" },
      editions: [],
      collections: [],
      availableOperations: { canCreateEdition: false },
    });
    await import("/marketplace/src/ui/item-detail-dialog.js");
    const dialog = document.createElement("artaround-item-detail-dialog");
    dialog.setAttribute("content-space-id", "space-acceptance");
    dialog.setAttribute("item-id", "item-acceptance");
    document.body.append(dialog);
  });

  const panel = page.locator('.item-detail-modal-layer[data-artaround-layer="modal"] .item-detail-modal');
  await expect(panel.getByRole("heading", { name: "Dettaglio contenuto" })).toBeVisible();
  const loadingBox = await panel.boundingBox();
  expect(loadingBox).not.toBeNull();

  await page.evaluate(() => window.__resolveItemDetailAcceptance());
  await expect(panel.getByRole("heading", { name: "Opera acceptance" })).toBeVisible();
  const loadedBox = await panel.boundingBox();
  expect(loadedBox).not.toBeNull();

  expect(Math.abs(loadingBox.width - loadedBox.width)).toBeLessThanOrEqual(1);
  expect(Math.abs(loadingBox.height - loadedBox.height)).toBeLessThanOrEqual(1);
  expect(loadedBox.height).toBeGreaterThan(500);
});