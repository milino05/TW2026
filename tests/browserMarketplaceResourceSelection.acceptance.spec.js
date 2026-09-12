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

test("custom-element modal rerenders hand off the visual layer without a backdrop or scroll-lock gap", async ({ page }) => {
  await page.goto(`${BASE_URL}/marketplace/`, { waitUntil: "domcontentloaded" });

  const state = await page.evaluate(async () => {
    const { mountModalInteraction } = await import("/marketplace/src/application/modal-interaction.js");
    const host = document.createElement("artaround-modal-handoff-acceptance");
    host.innerHTML = `<div class="artaround-modal-layer" data-modal-backdrop="true"><section class="artaround-task-modal artaround-task-modal--large" role="dialog" aria-modal="true" aria-label="Primo render"><div class="artaround-task-modal__body">Primo</div></section></div>`;
    document.body.append(host);

    const first = host.querySelector(".artaround-modal-layer");
    const firstController = mountModalInteraction({
      layer: first,
      panel: () => first.querySelector(".artaround-task-modal"),
      lockScroll: true,
    });

    firstController.release({ restoreFocus: false });
    const afterRelease = {
      parent: first.parentElement?.tagName || null,
      kind: first.dataset.artaroundLayer || null,
      mountedCount: document.body.querySelectorAll('.artaround-modal-layer[data-artaround-layer="modal"]').length,
      scrollLocked: document.documentElement.classList.contains("artaround-layer-scroll-lock"),
    };

    host.innerHTML = `<div class="artaround-modal-layer" data-modal-backdrop="true"><section class="artaround-task-modal artaround-task-modal--large" role="dialog" aria-modal="true" aria-label="Secondo render"><div class="artaround-task-modal__body">Secondo</div></section></div>`;
    const second = host.querySelector(".artaround-modal-layer");
    const secondController = mountModalInteraction({
      layer: second,
      panel: () => second.querySelector(".artaround-task-modal"),
      lockScroll: true,
    });

    const duringHandoff = {
      firstParent: first.parentElement?.tagName || null,
      secondParent: second.parentElement?.tagName || null,
      mountedCount: document.body.querySelectorAll('.artaround-modal-layer[data-artaround-layer="modal"]').length,
      scrollLocked: document.documentElement.classList.contains("artaround-layer-scroll-lock"),
    };

    await Promise.resolve();
    const afterCheckpoint = {
      firstConnected: first.isConnected,
      secondParent: second.parentElement?.tagName || null,
      mountedCount: document.body.querySelectorAll('.artaround-modal-layer[data-artaround-layer="modal"]').length,
      scrollLocked: document.documentElement.classList.contains("artaround-layer-scroll-lock"),
    };

    secondController.release({ restoreFocus: true });
    host.remove();
    return { afterRelease, duringHandoff, afterCheckpoint };
  });

  expect(state.afterRelease).toEqual({ parent: "BODY", kind: "modal", mountedCount: 1, scrollLocked: true });
  expect(state.duringHandoff).toEqual({ firstParent: "BODY", secondParent: "BODY", mountedCount: 2, scrollLocked: true });
  expect(state.afterCheckpoint).toEqual({ firstConnected: false, secondParent: "BODY", mountedCount: 1, scrollLocked: true });
});