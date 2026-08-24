const BASE_PATH = "/marketplace";
const ROUTES = new Set([
  "/",
  "/catalog",
  "/catalog/detail",
  "/acquisitions",
  "/workspace",
  "/workspace/resource",
  "/workspace/commerce",
  "/workspace/item-authoring",
  "/workspace/visit-authoring",
  "/workspace/venue-targets",
  "/workspace/context-compose",
  "/profile",
  "/organizations/detail",
  "/namespaces/editor",
  "/venues/editor",
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
}

export { BASE_PATH };
