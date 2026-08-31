const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const marketplace = fs.readFileSync(path.join(root, "clients/marketplace/src/ui/feedback-primitives.js"), "utf8");
const navigator = fs.readFileSync(path.join(root, "clients/navigator/src/ui/FeedbackToastHost.vue"), "utf8");

test("Marketplace mantiene nodi toast stabili durante il ciclo di vita", () => {
  assert.match(marketplace, /toastNode\(id\)/);
  assert.match(marketplace, /upsertToast\(entry\)/);
  assert.match(marketplace, /node\.dataset\.state = "exiting"/);
  assert.doesNotMatch(marketplace, /this\.innerHTML = `<div class="artaround-toast-stack">\$\{this\.notifications\.map/);
});

test("Marketplace anima il reflow quando un toast scade", () => {
  assert.match(marketplace, /animateReflow\(previousRects\)/);
  assert.match(marketplace, /getBoundingClientRect\(\)/);
  assert.match(marketplace, /node\.animate\(/);
  assert.match(marketplace, /prefers-reduced-motion: reduce/);
});

test("Navigator usa TransitionGroup anche per il movimento della pila", () => {
  assert.match(navigator, /<TransitionGroup name="feedback-toast"/);
  assert.match(navigator, /\.feedback-toast-enter-active/);
  assert.match(navigator, /\.feedback-toast-leave-active/);
  assert.match(navigator, /\.feedback-toast-move/);
});
