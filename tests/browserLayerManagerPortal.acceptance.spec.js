const { test, expect } = require("@playwright/test");

const BASE_URL = process.env.ARTAROUND_ACCEPTANCE_BASE_URL || "http://127.0.0.1:8000";

test("LayerManager restores multiple sibling portals to their exact owner order", async ({ page }) => {
  await page.goto(`${BASE_URL}/marketplace/`, { waitUntil: "domcontentloaded" });

  const state = await page.evaluate(async () => {
    const { mountUiLayer } = await import("/marketplace/src/application/layer-manager.js");
    const host = document.createElement("artaround-layer-sibling-acceptance");
    const marker = (name, tag = "div") => {
      const element = document.createElement(tag);
      element.dataset.acceptanceNode = name;
      return element;
    };
    const before = marker("before", "span");
    const first = marker("first");
    const second = marker("second");
    const third = marker("third");
    const after = marker("after", "span");
    host.append(before, first, second, third, after);
    document.body.append(host);

    const releases = [first, second, third].map((layer) => mountUiLayer(layer, { kind: "modal", lockScroll: true }));
    const mounted = {
      parents: [first, second, third].map((layer) => layer.parentElement?.tagName || null),
      locked: document.documentElement.classList.contains("artaround-layer-scroll-lock"),
    };

    // Release deliberately in owner order. This reproduces the Venue lifecycle
    // where a lower modal used to remember a sibling that had also been portalled.
    for (const release of releases) release();

    const restored = {
      order: [...host.children].map((node) => node.dataset.acceptanceNode),
      parents: [first, second, third].map((layer) => layer.parentElement?.tagName || null),
      locked: document.documentElement.classList.contains("artaround-layer-scroll-lock"),
      anchors: [...host.childNodes].filter((node) => node.nodeType === Node.COMMENT_NODE).length,
    };
    host.remove();
    return { mounted, restored };
  });

  expect(state.mounted.parents).toEqual(["BODY", "BODY", "BODY"]);
  expect(state.mounted.locked).toBe(true);
  expect(state.restored.parents).toEqual([
    "ARTAROUND-LAYER-SIBLING-ACCEPTANCE",
    "ARTAROUND-LAYER-SIBLING-ACCEPTANCE",
    "ARTAROUND-LAYER-SIBLING-ACCEPTANCE",
  ]);
  expect(state.restored.order).toEqual(["before", "first", "second", "third", "after"]);
  expect(state.restored.anchors).toBe(0);
  expect(state.restored.locked).toBe(false);
});
