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
  await page.locator("artaround-toast-center").waitFor();
  await installOrdinaryOverlay(page);

  const entries = [
    { id: "acceptance-toast-1", message: "Prima notifica", tone: "success", duration: 0, dismissible: true },
    { id: "acceptance-toast-2", message: "Seconda notifica", tone: "info", duration: 0, dismissible: true },
    { id: "acceptance-toast-3", message: "Terza notifica", tone: "warning", duration: 0, dismissible: true },
  ];
  for (const entry of entries) await dispatchNotification(page, entry);

  const toasts = page.locator(".artaround-toast");
  await expect(toasts).toHaveCount(3);
  await expect(toasts).toHaveText(["Prima notifica×", "Seconda notifica×", "Terza notifica×"]);

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
  await page.locator("artaround-toast-center").waitFor();
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

test("Navigator toast stack is FIFO, stable and globally layered in a real browser", async ({ page }) => {
  await page.goto(`${BASE_URL}/navigator/`, { waitUntil: "domcontentloaded" });
  await page.locator(".feedback-toast-host").waitFor();
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
  await page.locator(".feedback-toast-host").waitFor();
  await dispatchNotification(page, {
    id: "navigator-mobile",
    message: "Notifica Navigator mobile",
    tone: "info",
    duration: 0,
    dismissible: true,
  });

  const hostBox = await page.locator(".feedback-toast-host").boundingBox();
  expect(hostBox).not.toBeNull();
  expect(hostBox.x).toBeGreaterThanOrEqual(0);
  expect(hostBox.x + hostBox.width).toBeLessThanOrEqual(390);

  const transitionDuration = await page.locator(".feedback-toast").evaluate((node) => getComputedStyle(node).transitionDuration);
  expect(transitionDuration.split(",").every((value) => value.trim() === "0s")).toBeTruthy();
});
