/** @vitest-environment jsdom */
import { describe, expect, it } from "vitest";

import { copyInlineStyles } from "./inline-styles";

describe("copyInlineStyles", () => {
  it("copies Vite-injected styles into an external document in source order", () => {
    document.head.innerHTML = [
      '<style data-vite-dev-id="react.css">.pf-workspace { display: grid; }</style>',
      '<style media="screen">.demo-external-header { display: flex; }</style>',
    ].join("");
    const destination = document.implementation.createHTMLDocument("External surface");

    copyInlineStyles(document, destination);

    const styles = [...destination.querySelectorAll("style")];
    expect(styles.map((style) => style.textContent)).toEqual([
      ".pf-workspace { display: grid; }",
      ".demo-external-header { display: flex; }",
    ]);
    expect(styles[0]?.dataset.viteDevId).toBe("react.css");
    expect(styles[1]?.media).toBe("screen");
  });
});
