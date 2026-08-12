import { useCallback, useSyncExternalStore } from "react";

const navigationEvent = "panefold:navigation";

function basePath(): string {
  return import.meta.env.BASE_URL.replace(/\/$/, "");
}

export function sitePath(path: string): string {
  const normalized = path.startsWith("/") ? path : `/${path}`;
  return `${basePath()}${normalized}` || "/";
}

export function siteAsset(path: string): string {
  return `${import.meta.env.BASE_URL}${path.replace(/^\//, "")}`;
}

function currentPath(): string {
  const base = basePath();
  const pathname = window.location.pathname;
  if (base !== "" && pathname.startsWith(base)) {
    return `${normalizedPathname(pathname.slice(base.length) || "/")}${window.location.hash}`;
  }
  return `${normalizedPathname(pathname || "/")}${window.location.hash}`;
}

function normalizedPathname(pathname: string): string {
  if (pathname.length <= 1) return pathname;
  return pathname.replace(/\/+$/, "");
}

function subscribe(onStoreChange: () => void): () => void {
  window.addEventListener("popstate", onStoreChange);
  window.addEventListener(navigationEvent, onStoreChange);
  return () => {
    window.removeEventListener("popstate", onStoreChange);
    window.removeEventListener(navigationEvent, onStoreChange);
  };
}

export function useRoute(): readonly [string, (path: string) => void] {
  const path = useSyncExternalStore(subscribe, currentPath, () => "/");
  const navigate = useCallback((next: string) => {
    window.history.pushState(null, "", sitePath(next));
    window.dispatchEvent(new Event(navigationEvent));
    const hash = next.includes("#") ? next.slice(next.indexOf("#") + 1) : "";
    if (hash === "") {
      window.scrollTo({ top: 0, behavior: "instant" });
      window.requestAnimationFrame(() => {
        const main = document.querySelector<HTMLElement>("main");
        if (main === null) return;
        main.tabIndex = -1;
        main.focus({ preventScroll: true });
      });
    } else {
      window.requestAnimationFrame(() => document.getElementById(hash)?.scrollIntoView());
    }
  }, []);
  return [path, navigate] as const;
}
