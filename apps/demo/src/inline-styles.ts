/**
 * Copies development-time inline styles into a newly bootstrapped browser
 * surface. Production CSS is linked through the surface presentation, while
 * Vite injects imported CSS as style elements during development.
 */
export function copyInlineStyles(source: Document, destination: Document): void {
  for (const sourceStyle of source.querySelectorAll("style")) {
    const destinationStyle = destination.createElement("style");
    for (const attribute of sourceStyle.attributes) {
      destinationStyle.setAttribute(attribute.name, attribute.value);
    }
    destinationStyle.textContent = sourceStyle.textContent;
    destination.head.append(destinationStyle);
  }
}
