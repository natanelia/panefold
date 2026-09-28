import { lazy, Suspense } from "react";
import { createRoot } from "react-dom/client";

import App from "./App";

const root = document.getElementById("root");
if (root === null) throw new Error("Demo root element is missing");

const isStarter = new URL(location.href).searchParams.get("fixture") === "starter";
const StarterWorkspace = lazy(() => import("./docs-starter"));
if (isStarter) document.body.classList.remove("pf-hide-single-tab-row");
createRoot(root).render(
  isStarter ? (
    <Suspense fallback={<p>Loading starter…</p>}>
      <StarterWorkspace />
    </Suspense>
  ) : (
    <App />
  ),
);
