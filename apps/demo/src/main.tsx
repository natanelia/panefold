import { lazy, Suspense } from "react";
import { createRoot } from "react-dom/client";

import App from "./App";

const root = document.getElementById("root");
if (root === null) throw new Error("Demo root element is missing");

// Choose an example once at bootstrap. Rotation never replaces a live workspace.
const fixture = new URL(location.href).searchParams.get("fixture");
const isTouch =
  fixture === "touch" ||
  (fixture === null && window.matchMedia("(max-width: 700px), (pointer: coarse)").matches);
const TouchPlayground = lazy(() => import("./TouchPlayground"));
const isStarter = new URL(location.href).searchParams.get("fixture") === "starter";
const StarterWorkspace = lazy(() => import("./docs-starter"));
if (isStarter || isTouch) document.body.classList.remove("pf-hide-single-tab-row");
createRoot(root).render(
  isTouch ? (
    <Suspense fallback={<p>Opening playground…</p>}>
      <TouchPlayground />
    </Suspense>
  ) : isStarter ? (
    <Suspense fallback={<p>Loading starter…</p>}>
      <StarterWorkspace />
    </Suspense>
  ) : (
    <App />
  ),
);
