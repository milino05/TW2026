const { test, expect } = require("@playwright/test");

const BASE_URL = process.env.ARTAROUND_ACCEPTANCE_BASE_URL || "http://127.0.0.1:8000";

async function dispatchNotification(page, detail) {
  await page.evaluate((payload) => {
    window.dispatchEvent(new CustomEvent("artaround:notification", { detail: payload }));
  }, detail);
}

async function dismissNotification(page, id) {
  await page.evaluate((notificationId) => {
    window.dispatchEvent(new CustomEvent("artaround:notification:dismiss", {
      detail: { id: notificationId },
    }));
  }, id);
}

async function installOrdinaryOverlay(page) {
  await page.evaluate(() => {
    const previous = document.querySelector("#acceptance-ordinary-overlay");
    previous?.remove();
    const overlay = document.createElement("div");
    overlay.id = "acceptance-ordinary-overlay";
    Object.assign(overlay.style, {
      position: "fixed",
      inset: "0",
      zIndex: "999999",
      pointerEvents: "none",
    });
    document.body.append(overlay);
  });
}

test("Marketplace feedback behaves correctly in a real browser", async ({ page }) => {
  await page.goto(`${BASE_URL}/marketplace/`, { waitUntil: "domcontentloaded" });
  await page.locator("artaround-toast-center").waitFor({ state: "attached" });
  await installOrdinaryOverlay(page);

  const entries = [
    { id: "acceptance-toast-1", message: "Prima notifica", tone: "success", duration: 0, dismissible: true },
    { id: "acceptance-toast-2", message: "Seconda notifica", tone: "info", duration: 0, dismissible: true },
    { id: "acceptance-toast-3", message: "Terza notifica", tone: "warning", duration: 0, dismissible: true },
  ];
  for (const entry of entries) await dispatchNotification(page, entry);

  const toasts = page.locator(".artaround-toast");
  await expect(toasts).toHaveCount(3);
  await expect(toasts).toContainText(["Prima notifica", "Seconda notifica", "Terza notifica"]);

  const tops = await toasts.evaluateAll((nodes) => nodes.map((node) => node.getBoundingClientRect().top));
  expect(tops[0]).toBeLessThan(tops[1]);
  expect(tops[1]).toBeLessThan(tops[2]);

  const layers = await page.evaluate(() => ({
    toast: Number.parseInt(getComputedStyle(document.querySelector("artaround-toast-center")).zIndex, 10),
    ordinary: Number.parseInt(getComputedStyle(document.querySelector("#acceptance-ordinary-overlay")).zIndex, 10),
  }));
  expect(layers.toast).toBeGreaterThan(layers.ordinary);

  await page.evaluate(() => {
    document.querySelector('[data-toast-id="acceptance-toast-2"]').dataset.acceptanceMarker = "stable";
  });
  await dismissNotification(page, "acceptance-toast-1");
  await expect(page.locator('[data-toast-id="acceptance-toast-1"]')).toHaveAttribute("data-state", "exiting");
  await page.waitForTimeout(260);
  await expect(toasts).toHaveCount(2);
  await expect(page.locator('[data-toast-id="acceptance-toast-2"]')).toHaveAttribute("data-acceptance-marker", "stable");

  await dispatchNotification(page, {
    id: "acceptance-auto-dismiss",
    message: "Scadenza automatica",
    tone: "neutral",
    duration: 300,
    dismissible: true,
  });
  await expect(page.locator('[data-toast-id="acceptance-auto-dismiss"]')).toBeVisible();
  await page.waitForTimeout(650);
  await expect(page.locator('[data-toast-id="acceptance-auto-dismiss"]')).toHaveCount(0);

  await page.evaluate(() => {
    const origin = document.createElement("button");
    origin.id = "acceptance-dialog-origin";
    origin.textContent = "Origine focus";
    document.body.append(origin);
    origin.focus();

    const dialog = document.createElement("artaround-action-dialog");
    dialog.id = "acceptance-action-dialog";
    dialog.hidden = true;
    document.body.append(dialog);
    dialog.present({
      title: "Uscire senza salvare?",
      message: "Le modifiche locali andranno perse.",
      confirmLabel: "Esci",
      cancelLabel: "Resta",
      tone: "danger",
    });
  });

  const dialog = page.locator("#acceptance-action-dialog");
  await expect(dialog.locator('[role="dialog"]')).toBeVisible();
  await expect(dialog.locator('[role="dialog"]')).toHaveAttribute("aria-modal", "true");
  await expect(dialog.locator("[data-dialog-cancel]")).toBeFocused();

  await dialog.locator("[data-dialog-confirm]").focus();
  await page.keyboard.press("Tab");
  await expect(dialog.locator("[data-dialog-cancel]")).toBeFocused();

  await dispatchNotification(page, {
    id: "acceptance-over-dialog",
    message: "Notifica sopra dialog",
    tone: "warning",
    duration: 0,
    dismissible: true,
  });
  const globalLayers = await page.evaluate(() => ({
    toast: Number.parseInt(getComputedStyle(document.querySelector("artaround-toast-center")).zIndex, 10),
    dialog: Number.parseInt(getComputedStyle(document.querySelector("#acceptance-action-dialog")).zIndex, 10),
  }));
  expect(globalLayers.toast).toBeGreaterThan(globalLayers.dialog);

  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await expect(page.locator("#acceptance-dialog-origin")).toBeFocused();
});

test("Marketplace global feedback stays inside a mobile viewport", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`${BASE_URL}/marketplace/`, { waitUntil: "domcontentloaded" });
  await page.locator("artaround-toast-center").waitFor({ state: "attached" });
  await dispatchNotification(page, {
    id: "acceptance-mobile-marketplace",
    message: "Notifica mobile con testo sufficientemente lungo da verificare il contenimento nel viewport.",
    tone: "info",
    duration: 0,
    dismissible: true,
  });

  const box = await page.locator("artaround-toast-center").boundingBox();
  expect(box).not.toBeNull();
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width).toBeLessThanOrEqual(390);
});

test("Semantic Graph Workspace navigates a paged first-level graph in a real browser", async ({ page }) => {
  const contextId = "64a12f6800000000000000aa";
  const alphaId = "64a12f6800000000000000a1";
  const betaId = "64a12f6800000000000000b2";
  const gammaId = "64a12f6800000000000000c3";
  const revisionId = "64a12f6800000000000000d4";
  const semanticGraphId = "64a12f6800000000000000e5";
  const namespaceRevisionId = "64a12f6800000000000000f6";
  const subjects = {
    [alphaId]: { _id: alphaId, preferredLabel: "Alpha", description: "Soggetto centrale" },
    [betaId]: { _id: betaId, preferredLabel: "Beta", description: "Primo vicino" },
    [gammaId]: { _id: gammaId, preferredLabel: "Gamma", description: "Secondo vicino" },
  };
  const entry = (subjectId, relationCount) => ({
    subject: subjects[subjectId],
    subjectClassDefinitionIds: [],
    relationCount,
    presentationCoverage: { collectionItemCount: subjectId === alphaId ? 1 : 0, contentSpaceItemCount: 0, artaroundItemCount: 0 },
  });
  const edgeAB = { id: "64a12f680000000000000111", sourceSubjectId: alphaId, targetSubjectId: betaId, relationTypeDefinitionId: "related", weight: 1, metadata: null, provenance: null };
  const edgeAC = { id: "64a12f680000000000000112", sourceSubjectId: alphaId, targetSubjectId: gammaId, relationTypeDefinitionId: "related", weight: 1, metadata: null, provenance: null };

  await page.route("**/api/editorial-contexts/**/semantic-graph/neighborhood**", async (route) => {
    const url = new URL(route.request().url());
    const focus = url.searchParams.get("focusSubjectId");
    const limit = Number(url.searchParams.get("limit") || 18);
    const base = {
      semanticGraph: { id: semanticGraphId, name: "Grafo acceptance", workingVersion: 3, workingRevisionId: revisionId },
      revision: { id: revisionId, version: 3, basedOnRevisionId: null, authoredAgainstNamespaceRevisionId: namespaceRevisionId },
      effectiveNamespaceRevisionId: namespaceRevisionId,
    };
    if (!focus) {
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ...base, subjects: [], edges: [], neighborhood: { focusSubjectId: null, totalSubjects: 3, totalEdges: 2, totalNeighbors: 0, visibleNeighbors: 0, hiddenNeighbors: 0, limit } }) });
      return;
    }
    if (focus === betaId) {
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ...base, subjects: [entry(betaId, 1), entry(alphaId, 2)], edges: [edgeAB], neighborhood: { focusSubjectId: betaId, totalSubjects: 3, totalEdges: 2, totalNeighbors: 1, visibleNeighbors: 1, hiddenNeighbors: 0, limit } }) });
      return;
    }
    const expanded = limit > 18;
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ...base, subjects: expanded ? [entry(alphaId, 2), entry(betaId, 1), entry(gammaId, 1)] : [entry(alphaId, 2), entry(betaId, 1)], edges: expanded ? [edgeAB, edgeAC] : [edgeAB], neighborhood: { focusSubjectId: alphaId, totalSubjects: 3, totalEdges: 2, totalNeighbors: 2, visibleNeighbors: expanded ? 2 : 1, hiddenNeighbors: expanded ? 0 : 1, limit } }) });
  });

  await page.route("**/api/editorial-contexts/**/semantic-graph/subject-candidates**", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        results: [entry(alphaId, 2), entry(betaId, 1), entry(gammaId, 1)].map((value) => ({ ...value, inGraph: true })),
        pagination: { page: 1, limit: 12, total: 3, totalPages: 1 },
        query: "",
        scope: "graph",
      }),
    });
  });

  await page.goto(`${BASE_URL}/marketplace/`, { waitUntil: "domcontentloaded" });
  await page.evaluate(() => customElements.whenDefined("artaround-semantic-graph-editor"));
  await page.evaluate(({ contextId: idValue }) => {
    const previous = document.querySelector("#acceptance-semantic-graph");
    previous?.remove();
    const editor = document.createElement("artaround-semantic-graph-editor");
    editor.id = "acceptance-semantic-graph";
    document.body.append(editor);
    editor.configure({
      editorialContextId: idValue,
      editable: true,
      locked: false,
      relationTypes: [{ definitionId: "related", label: "Collega", domainDefinitionIds: [], rangeDefinitionIds: [] }],
      subjectClasses: [],
    });
  }, { contextId });

  const editor = page.locator("#acceptance-semantic-graph");
  await expect(editor.getByText("Nessun soggetto di contesto")).toBeVisible();
  await expect(editor.getByText("Il grafo contiene 3 soggetti.", { exact: false })).toBeVisible();

  await editor.getByRole("button", { name: "Scegli soggetto" }).click();
  await expect(editor.getByRole("heading", { name: "Scegli il soggetto di contesto" })).toBeVisible();
  await expect(editor.locator("[data-use-inventory-subject]")).toHaveCount(3);
  await editor.locator(`[data-use-inventory-subject="${alphaId}"]`).click();

  await expect(editor.locator('[data-graph-subject]')).toHaveCount(2);
  await expect(editor.getByText("1 di 2 soggetti collegati mostrati")).toBeVisible();
  await editor.getByRole("button", { name: "Mostra altri" }).click();
  await expect(editor.locator('[data-graph-subject]')).toHaveCount(3);
  await expect(editor.getByRole("button", { name: "Mostra altri" })).toHaveCount(0);

  await editor.locator("[data-close-graph-inspector]").click();
  await editor.locator(`[data-graph-subject="${betaId}"]`).dblclick();
  await expect(editor.locator(".semantic-graph-toolbar strong")).toHaveText("Beta");
  await expect(editor.locator('[data-graph-subject]')).toHaveCount(2);

  await editor.getByRole("button", { name: "Aggiungi relazione" }).click();
  await editor.locator(`[data-use-inventory-subject="${alphaId}"]`).click();
  await expect(editor.getByRole("heading", { name: "Beta → Alpha" })).toBeVisible();
  await expect(editor.locator('[data-relation-composer] select[name="relationTypeDefinitionId"]')).toHaveValue("related");
});

test("Navigator toast stack is FIFO, stable and globally layered in a real browser", async ({ page }) => {
  await page.goto(`${BASE_URL}/navigator/`, { waitUntil: "domcontentloaded" });
  await page.locator(".feedback-toast-host").waitFor({ state: "attached" });
  await installOrdinaryOverlay(page);

  const entries = [
    { id: "navigator-toast-1", message: "Navigazione uno", tone: "info", duration: 0, dismissible: true },
    { id: "navigator-toast-2", message: "Navigazione due", tone: "success", duration: 0, dismissible: true },
    { id: "navigator-toast-3", message: "Navigazione tre", tone: "warning", duration: 0, dismissible: true },
  ];
  for (const entry of entries) await dispatchNotification(page, entry);

  const toasts = page.locator(".feedback-toast");
  await expect(toasts).toHaveCount(3);
  await expect(toasts).toContainText(["Navigazione uno", "Navigazione due", "Navigazione tre"]);

  const tops = await toasts.evaluateAll((nodes) => nodes.map((node) => node.getBoundingClientRect().top));
  expect(tops[0]).toBeLessThan(tops[1]);
  expect(tops[1]).toBeLessThan(tops[2]);

  const layers = await page.evaluate(() => ({
    toast: Number.parseInt(getComputedStyle(document.querySelector(".feedback-toast-host")).zIndex, 10),
    ordinary: Number.parseInt(getComputedStyle(document.querySelector("#acceptance-ordinary-overlay")).zIndex, 10),
  }));
  expect(layers.toast).toBeGreaterThan(layers.ordinary);

  await toasts.nth(1).evaluate((node) => { node.dataset.acceptanceMarker = "stable"; });
  await dismissNotification(page, "navigator-toast-1");
  await page.waitForTimeout(260);
  await expect(toasts).toHaveCount(2);
  await expect(toasts.first()).toHaveAttribute("data-acceptance-marker", "stable");

  await dispatchNotification(page, {
    id: "navigator-auto-dismiss",
    message: "Navigator auto dismiss",
    tone: "neutral",
    duration: 300,
    dismissible: true,
  });
  await expect(page.getByText("Navigator auto dismiss", { exact: true })).toBeVisible();
  await page.waitForTimeout(650);
  await expect(page.getByText("Navigator auto dismiss", { exact: true })).toHaveCount(0);
});

test("Navigator feedback remains contained on mobile and honors reduced motion", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto(`${BASE_URL}/navigator/`, { waitUntil: "domcontentloaded" });
  await page.locator(".feedback-toast-host").waitFor({ state: "attached" });
  await expect.poll(() => page.evaluate(() => matchMedia("(prefers-reduced-motion: reduce)").matches)).toBe(true);

  await dispatchNotification(page, {
    id: "navigator-mobile",
    message: "Notifica Navigator mobile",
    tone: "info",
    duration: 0,
    dismissible: true,
  });

  const toast = page.locator(".feedback-toast");
  await expect(toast).toBeVisible();
  const hostBox = await page.locator(".feedback-toast-host").boundingBox();
  expect(hostBox).not.toBeNull();
  expect(hostBox.x).toBeGreaterThanOrEqual(0);
  expect(hostBox.x + hostBox.width).toBeLessThanOrEqual(390);

  await page.waitForTimeout(50);
  const reducedMotionState = await toast.evaluate((node) => {
    const style = getComputedStyle(node);
    return {
      opacity: style.opacity,
      transform: style.transform,
      activeAnimations: node.getAnimations().filter((animation) => animation.playState === "running").length,
    };
  });
  expect(reducedMotionState).toEqual({ opacity: "1", transform: "none", activeAnimations: 0 });
});
