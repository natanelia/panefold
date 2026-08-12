import type { AnchorHTMLAttributes, MouseEvent } from "react";

import { sitePath } from "../lib/router";

interface SiteLinkProps extends Omit<AnchorHTMLAttributes<HTMLAnchorElement>, "href"> {
  readonly to: string;
  readonly navigate: (path: string) => void;
}

export function SiteLink({ to, navigate, onClick, ...props }: SiteLinkProps) {
  const handleClick = (event: MouseEvent<HTMLAnchorElement>) => {
    onClick?.(event);
    if (
      event.defaultPrevented ||
      event.button !== 0 ||
      event.metaKey ||
      event.ctrlKey ||
      event.shiftKey ||
      event.altKey
    ) {
      return;
    }
    event.preventDefault();
    navigate(to);
  };

  return <a href={sitePath(to)} onClick={handleClick} {...props} />;
}
