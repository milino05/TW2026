const BASE_PATH = "/marketplace";
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
  "/workspace/venue-targets",
  "/workspace/context-compose",
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
  if (!message) return;
  const shell = document.querySelector(".market-shell");
  if (!shell) return;
  const previous = shell.querySelector("[data-route-feedback]");
  previous?.remove();
  const feedback = document.createElement("p");
  feedback.dataset.routeFeedback = "true";
  feedback.className = "feedback-success route-feedback";
  feedback.setAttribute("role", "status");
  feedback.textContent = message;
  const header = shell.querySelector(".market-header");
  if (header?.nextSibling) shell.insertBefore(feedback, header.nextSibling);
  else shell.append(feedback);
}

export function currentRoute() {
  const pathname = stripBase(window.location.pathname);
  return ROUTES.has(pathname) ? pathname : "/404";
}

export function navigate(path) {
  const parsed = parseLogicalUrl(path);
  const pathname = ROUTES.has(parsed.pathname) ? parsed.pathname : "/404";
  const deployedPath = pathname === "/" ? `${BASE_PATH}/` : `${BASE_PATH}${pathname}`;
  window.history.pushState({}, "", `${deployedPath}${parsed.search}${parsed.hash}`);
  window.dispatchEvent(new PopStateEvent("popstate"));
  showRouteFeedback(routeFeedback(pathname, parsed.search));
}

export { BASE_PATH };
