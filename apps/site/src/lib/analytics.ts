import { useEffect } from "react";

interface MarketingEvent {
  readonly name: string;
  readonly path: string;
}

declare global {
  interface Window {
    dataLayer?: unknown[];
  }
}

export function useMarketingAnalytics(path: string): void {
  useEffect(() => {
    publish({ name: "page_view", path });
  }, [path]);

  useEffect(() => {
    const onClick = (event: MouseEvent) => {
      const target = event.target;
      if (!(target instanceof Element)) return;
      const tracked = target.closest<HTMLElement>("[data-track]");
      const name = tracked?.dataset.track;
      if (name !== undefined) publish({ name, path });
    };
    document.addEventListener("click", onClick);
    return () => document.removeEventListener("click", onClick);
  }, [path]);
}

function publish(event: MarketingEvent): void {
  window.dispatchEvent(new CustomEvent("panefold:marketing", { detail: event }));
  window.dataLayer?.push({ event: `panefold_${event.name}`, path: event.path });
}
