/**
 * Copies development-time inline styles into a newly bootstrapped browser
 * surface. Production CSS is linked through the surface presentation, while
 * Vite injects imported CSS as style elements during development.
 *
 * Returns a disposer because Vite can add, remove, and update those style
 * elements after the external surface has mounted.
 */
export function copyInlineStyles(source: Document, destination: Document): () => void {
  const copies = new Map<HTMLStyleElement, HTMLStyleElement>();

  const sync = () => {
    const sourceStyles = [...source.head.querySelectorAll("style")];
    const activeStyles = new Set(sourceStyles);

    for (const [sourceStyle, destinationStyle] of copies) {
      if (!activeStyles.has(sourceStyle)) {
        destinationStyle.remove();
        copies.delete(sourceStyle);
      }
    }

    const destinationStyles = sourceStyles.map((sourceStyle) => {
      let destinationStyle = copies.get(sourceStyle);
      if (destinationStyle === undefined) {
        destinationStyle = destination.createElement("style");
        copies.set(sourceStyle, destinationStyle);
      }

      for (const attribute of [...destinationStyle.attributes]) {
        if (!sourceStyle.hasAttribute(attribute.name)) {
          destinationStyle.removeAttribute(attribute.name);
        }
      }
      for (const attribute of sourceStyle.attributes) {
        destinationStyle.setAttribute(attribute.name, attribute.value);
      }
      if (destinationStyle.textContent !== sourceStyle.textContent) {
        destinationStyle.textContent = sourceStyle.textContent;
      }
      return destinationStyle;
    });

    destination.head.append(...destinationStyles);
  };

  sync();
  const observer = new MutationObserver(sync);
  observer.observe(source.head, {
    subtree: true,
    childList: true,
    characterData: true,
    attributes: true,
  });

  return () => {
    observer.disconnect();
    for (const destinationStyle of copies.values()) {
      destinationStyle.remove();
    }
    copies.clear();
  };
}
