const ROUTES = new Set([
  "/",
  "/catalog",
  "/workspace",
  "/workspace/resource",
  "/workspace/item-authoring",
  "/workspace/venue-targets",
  "/workspace/context-compose",
]);

function routePath(path) {
  try { return new URL(path, window.location.origin).pathname; }
  catch { return "/404"; }
}

export function currentRoute() {
  return ROUTES.has(window.location.pathname) ? window.location.pathname : "/404";
}

export function navigate(path) {
  const pathname = routePath(path);
  if (!ROUTES.has(pathname)) path = "/404";
  window.history.pushState({}, "", path);
  window.dispatchEvent(new PopStateEvent("popstate"));
}
