import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "@fontsource-variable/jetbrains-mono/wght.css";
import "@fontsource-variable/manrope/wght.css";

import App from "./App";
import { installStructuredData } from "./lib/structuredData";
import "./styles.css";

const rootElement = document.getElementById("root");
if (rootElement === null) throw new Error("Panefold site root element is missing");
installStructuredData();

createRoot(rootElement).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
