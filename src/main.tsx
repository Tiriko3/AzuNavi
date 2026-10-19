import React, { Suspense, lazy } from "react";
import ReactDOM from "react-dom/client";
import "@fontsource/montserrat/800-italic.css";
import "@fontsource/montserrat/900-italic.css";
import "@fontsource/poppins/500.css";
import "@fontsource/poppins/600.css";
import "./styles.css";
import App from "./App";
import { isMobile } from "./platform";

// Handy: eigene Oberfläche im Hochformat (src/mobile). PC: die gewohnte Oberfläche.
const MobileApp = lazy(() => import("./mobile/MobileApp"));

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    {isMobile ? <Suspense fallback={null}><MobileApp /></Suspense> : <App />}
  </React.StrictMode>
);
