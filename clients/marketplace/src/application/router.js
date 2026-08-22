const ROUTES = new Set(["/", "/catalog", "/workspace"]);

export function currentRoute() {
  return ROUTES.has(window.location.pathname) ? window.location.pathname : "/404";
}

export function navigate(path) {
  if (!ROUTES.has(path)) path = "/404";
  window.history.pushState({}, "", path);
  window.dispatchEvent(new PopStateEvent("popstate"));
}
