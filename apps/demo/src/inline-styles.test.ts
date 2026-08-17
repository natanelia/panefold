/** @vitest-environment jsdom */
import { describe, expect, it } from "vitest";

import { copyInlineStyles } from "./inline-styles";

describe("copyInlineStyles", () => {
  it("keeps Vite-injected styles synchronized in an external document", async () => {
    const firstStyle = document.createElement("style");
    firstStyle.dataset.viteDevId = "react.css";
    firstStyle.textContent = ".pf-workspace { display: grid; }";

    const secondStyle = document.createElement("style");
    secondStyle.media = "screen";
    secondStyle.textContent = ".demo-external-header { display: flex; }";

    document.head.replaceChildren(firstStyle, secondStyle);
    const destination = document.implementation.createHTMLDocument("External surface");

    const dispose = copyInlineStyles(document, destination);

    const styles = [...destination.querySelectorAll("style")];
    expect(styles.map((style) => style.textContent)).toEqual([
      ".pf-workspace { display: grid; }",
      ".demo-external-header { display: flex; }",
    ]);
    expect(styles[0]?.dataset.viteDevId).toBe("react.css");
    expect(styles[1]?.media).toBe("screen");

    firstStyle.textContent = ".pf-workspace { display: flex; }";
    const thirdStyle = document.createElement("style");
    thirdStyle.textContent = ".demo-app { color-scheme: dark; }";
    document.head.append(thirdStyle);
    secondStyle.remove();
    await Promise.resolve();

    expect([...destination.querySelectorAll("style")].map((style) => style.textContent)).toEqual([
      ".pf-workspace { display: flex; }",
      ".demo-app { color-scheme: dark; }",
    ]);
    expect(destination.querySelector("style[data-vite-dev-id]")?.textContent).toBe(
      ".pf-workspace { display: flex; }",
    );

    dispose();
    expect(destination.querySelectorAll("style")).toHaveLength(0);
  });
});
