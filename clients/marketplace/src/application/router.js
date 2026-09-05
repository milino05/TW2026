import { confirmNavigationLoss, hasNavigationLossRisk } from "./navigation-loss-guard.js";
import { notify } from "./ui-feedback.js";

const BASE_PATH = "/marketplace";
const HISTORY_INDEX_KEY = "__artaroundHistoryIndex";
const ROUTES = new Set([
  "/",
  "/context",
  "/home",
  "/catalog",
  "/catalog/detail",
  "/organizations",
  "/organizations/public",
  "/organizations/detail",
  "/venues",
  "/venues/public",
  "/venues/editor",
  "/acquisitions",
  "/create",
  "/workspace",
  "/workspace/resource",
  "/workspace/commerce",
  "/workspace/item-authoring",
  "/workspace/visit-authoring",
  "/workspace/editorial-spaces",
  "/workspace/editorial-space",
  "/workspace/editorial-collection-new",
  "/workspace/editorial-studio",
  "/workspace/semantic-graph",
  "/profile",
  "/namespaces/editor",
  "/physical-vocabularies/editor",
]);

function stripBase(pathname) {
  if (pathname === BASE_PATH || pathname === `${BASE_PATH}/`) return "/";
  if (pathname.startsWith(`${BASE_PATH}/`)) return pathname.slice(BASE_PATH.length) || "/";
  return pathname;
}

function parseLogicalUrl(path) {
  try {
    const url = new URL(path, window.location.origin);
    return { pathname: stripBase(url.pathname), search: url.search, hash: url.hash };
  } catch {
    return { pathname: "/404", search: "", hash: "" };
  }
}

function routeFeedback(pathname, search) {
  const params = new URLSearchParams(search || "");
  if (pathname === "/organizations/detail" && params.get("removed") === "venue") {
    return "Sede rimossa. Release, layout e storico restano conservati; la sede non è più disponibile nelle superfici attive.";
  }
  return null;
}

function showRouteFeedback(message) {
  if (message) notify.success(message);
}

function currentBrowserUrl() {
  return `${window.location.pathname}${window.location.search}${window.location.hash}`;
}

let currentHistoryIndex = Number(window.history.state?.[HISTORY_INDEX_KEY]);
if (!Number.isFinite(currentHistoryIndex)) {
  currentHistoryIndex = 0;
  window.history.replaceState({ ...(window.history.state || {}), [HISTORY_INDEX_KEY]: currentHistoryIndex }, "", currentBrowserUrl());
}

export function replaceCurrentHistoryUrl(url, state = window.history.state) {
  window.history.replaceState({ ...(state || {}), [HISTORY_INDEX_KEY]: currentHistoryIndex }, "", url);
}

export function pushSameDocumentHistory(url, state = {}) {
  currentHistoryIndex += 1;
  const nextState = { ...(state || {}), [HISTORY_INDEX_KEY]: currentHistoryIndex };
  window.history.pushState(nextState, "", url);
  return nextState;
}

let pendingHistoryNavigation = null;
let allowedHistoryIndex = null;

function resumePendingHistoryNavigation() {
  const pending = pendingHistoryNavigation;
  if (!pending || !pending.restored || pending.confirmed === null) return;
  pendingHistoryNavigation = null;
  if (!pending.confirmed) return;
  allowedHistoryIndex = pending.to;
  window.history.go(pending.to - pending.from);
}

function onGuardedPopState(event) {
  const targetIndex = Number(event.state?.[HISTORY_INDEX_KEY]);
  if (!Number.isFinite(targetIndex)) return;

  if (allowedHistoryIndex === targetIndex) {
    allowedHistoryIndex = null;
    currentHistoryIndex = targetIndex;
    return;
  }

  if (pendingHistoryNavigation) {
    event.stopImmediatePropagation();
    if (targetIndex === pendingHistoryNavigation.from && !pendingHistoryNavigation.restored) {
      pendingHistoryNavigation.restored = true;
      currentHistoryIndex = pendingHistoryNavigation.from;
      resumePendingHistoryNavigation();
    }
    return;
  }

  if (!hasNavigationLossRisk()) {
    currentHistoryIndex = targetIndex;
    return;
  }

  if (targetIndex === currentHistoryIndex) return;
  event.stopImmediatePropagation();
  const pending = {
    from: currentHistoryIndex,
    to: targetIndex,
    restored: false,
    confirmed: null,
  };
  pendingHistoryNavigation = pending;

  window.history.go(pending.from - pending.to);
  confirmNavigationLoss({
    kind: "history",
    from: currentBrowserUrl(),
    targetHistoryIndex: targetIndex,
  }).then((confirmed) => {
    if (pendingHistoryNavigation !== pending) return;
    pending.confirmed = confirmed;
    resumePendingHistoryNavigation();
  });
}

window.addEventListener("popstate", onGuardedPopState, true);

export function currentRoute() {
  const pathname = stripBase(window.location.pathname);
  return ROUTES.has(pathname) ? pathname : "/404";
}

function commitNavigation(path) {
  const parsed = parseLogicalUrl(path);
  const pathname = ROUTES.has(parsed.pathname) ? parsed.pathname : "/404";
  const deployedPath = pathname === "/" ? `${BASE_PATH}/` : `${BASE_PATH}${pathname}`;
  pushSameDocumentHistory(`${deployedPath}${parsed.search}${parsed.hash}`);
  window.dispatchEvent(new PopStateEvent("popstate", { state: window.history.state }));
  showRouteFeedback(routeFeedback(pathname, parsed.search));
  return true;
}

export function navigate(path) {
  if (!hasNavigationLossRisk()) return commitNavigation(path);
  return confirmNavigationLoss({ kind: "route", from: currentBrowserUrl(), to: path })
    .then((confirmed) => confirmed ? commitNavigation(path) : false);
}

export { BASE_PATH };
