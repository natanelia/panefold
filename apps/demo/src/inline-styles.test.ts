/** @vitest-environment jsdom */
import { describe, expect, it } from "vitest";

import { copyInlineStyles } from "./inline-styles";

describe("copyInlineStyles", () => {
  it("copies Vite-injected styles into an external document in source order", () => {
    const firstStyle = document.createElement("style");
    firstStyle.dataset.viteDevId = "react.css";
    firstStyle.textContent = ".pf-workspace { display: grid; }";

    const secondStyle = document.createElement("style");
    secondStyle.media = "screen";
    secondStyle.textContent = ".demo-external-header { display: flex; }";

    document.head.replaceChildren(firstStyle, secondStyle);
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
