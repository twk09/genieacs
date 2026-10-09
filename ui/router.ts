const ROUTES = [
  "/",
  "/overview",
  "/wizard",
  "/devices",
  "/devices/:id",
  "/faults",
  "/presets",
  "/provisions",
  "/virtualParameters",
  "/files",
  "/config",
  "/permissions",
  "/users",
  "/views",
  "/login",
];

export function matchRoute(
  pathname: string,
): { route: string; pathname: string; params: Record<string, string> } | null {
  const pathParts = pathname.split("/").filter((p) => p);
  for (const route of ROUTES) {
    const patternParts = route.split("/").filter((p) => p);
    if (patternParts.length !== pathParts.length) continue;

    const params: Record<string, string> = {};
    const matched = patternParts.every((part, i) => {
      if (part.startsWith(":") && pathParts[i]) {
        try {
          params[part.slice(1)] = decodeURIComponent(pathParts[i]);
        } catch {
          return false;
        }
        return true;
      }
      return part === pathParts[i];
    });

    if (matched) return { route, pathname: "/" + pathParts.join("/"), params };
  }

  return null;
}

let handler: (
  path: string,
  params: URLSearchParams,
  signal: AbortSignal,
) => Promise<void>;

function navigateHandler(e: NavigateEvent): void {
  if (!e.canIntercept || e.downloadRequest || e.navigationType === "reload")
    return;

  const url = new URL(e.destination.url);

  if (url.origin !== window.origin) return;

  if (url.hash.startsWith("#!/")) {
    const u = new URL(url.origin + url.hash.slice(2));
    url.hash = "";
    url.pathname = u.pathname;
    url.search = u.search;
  } else if (e.hashChange) return;

  const match = matchRoute(url.pathname);

  if (!match) return;

  url.pathname = match.pathname;

  if (url.toString() !== e.destination.url) {
    e.intercept({
      precommitHandler(controller) {
        controller.redirect(url);
      },
    });
  }

  const params = new URLSearchParams(url.searchParams);
  for (const [k, v] of Object.entries(match.params)) params.set(k, v);

  e.intercept({
    handler: () => handler(match.route, params, e.signal),
  });
}

let fallbackController: AbortController | null = null;

function loadFallbackUrl(url: URL): Promise<void> {
  if (url.hash.startsWith("#!/")) {
    const hashUrl = new URL(url.origin + url.hash.slice(2));
    url.hash = "";
    url.pathname = hashUrl.pathname;
    url.search = hashUrl.search;
    window.history.replaceState(null, "", url);
  } else if (url.hash) {
    return Promise.resolve();
  }

  const match = matchRoute(url.pathname);
  if (!match) return Promise.resolve();
  url.pathname = match.pathname;

  const params = new URLSearchParams(url.searchParams);
  for (const [key, value] of Object.entries(match.params))
    params.set(key, value);

  fallbackController?.abort();
  fallbackController = new AbortController();
  return handler(match.route, params, fallbackController.signal);
}

function fallbackNavigate(url: URL, replace = false): Promise<void> {
  if (url.origin !== window.location.origin || !matchRoute(url.pathname)) {
    window.location.assign(url.href);
    return Promise.resolve();
  }

  url.pathname = matchRoute(url.pathname)!.pathname;
  window.history[replace ? "replaceState" : "pushState"](null, "", url);
  return loadFallbackUrl(url);
}

function fallbackClickHandler(e: MouseEvent): void {
  if (
    e.defaultPrevented ||
    e.button !== 0 ||
    e.metaKey ||
    e.ctrlKey ||
    e.shiftKey ||
    e.altKey ||
    !(e.target instanceof Element)
  )
    return;

  const anchor = e.target.closest("a[href]");
  if (
    !(anchor instanceof HTMLAnchorElement) ||
    anchor.hasAttribute("download") ||
    (anchor.target && anchor.target !== "_self") ||
    anchor.relList.contains("external")
  )
    return;

  const url = new URL(anchor.href);
  if (
    url.origin !== window.location.origin ||
    !matchRoute(url.pathname) ||
    (url.pathname === window.location.pathname &&
      url.search === window.location.search &&
      url.hash !== window.location.hash)
  )
    return;

  e.preventDefault();
  fallbackNavigate(url).catch(console.error);
}

export function initRouter(_handler: typeof handler): void {
  handler = _handler;

  if ("navigation" in window && window.navigation) {
    window.navigation.addEventListener("navigate", navigateHandler);

    // Initial render
    window.navigation.navigate(window.navigation.currentEntry!.url!, {
      history: "replace",
    });
  } else {
    document.addEventListener("click", fallbackClickHandler);
    window.addEventListener("popstate", () => {
      loadFallbackUrl(new URL(window.location.href)).catch(console.error);
    });
    loadFallbackUrl(new URL(window.location.href)).catch(console.error);
  }
}

export async function navigate(
  path: string,
  params?: Record<string, string>,
): Promise<void> {
  if (params) path += "?" + new URLSearchParams(params).toString();
  if (!("navigation" in window) || !window.navigation)
    return fallbackNavigate(new URL(path, window.location.href));
  await window.navigation.navigate(path).committed;
}

export async function redirect(
  path: string,
  params?: Record<string, string>,
): Promise<void> {
  if (params) path += "?" + new URLSearchParams(params).toString();
  if (!("navigation" in window) || !window.navigation)
    return fallbackNavigate(new URL(path, window.location.href), true);
  await window.navigation.navigate(path, { history: "replace" }).committed;
}

export async function reload(): Promise<void> {
  if (!("navigation" in window) || !window.navigation) {
    window.location.reload();
    return;
  }
  await window.navigation.reload().committed;
}
