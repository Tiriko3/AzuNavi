import React, { Suspense, lazy } from "react";
import ReactDOM from "react-dom/client";
import "@fontsource/montserrat/800-italic.css";
import "@fontsource/montserrat/900-italic.css";
import "@fontsource/poppins/500.css";
import "@fontsource/poppins/600.css";
import "./styles.css";
import App from "./App";
import { isMobile, isWebApp, usesDataFolder } from "./platform";
import { WebGate } from "./web/WebGate";
import { APP_VERSION } from "./version";

// Handy: eigene Oberfläche im Hochformat (src/mobile). PC: die gewohnte Oberfläche.
const MobileApp = lazy(() => import("./mobile/MobileApp"));

const app = isMobile ? <Suspense fallback={null}><MobileApp /></Suspense> : <App />;
ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    {usesDataFolder ? <WebGate>{app}</WebGate> : app}
  </React.StrictMode>
);

// Web-App: installierbar und offline nutzbar (Service Worker), nur im fertigen Build
if (isWebApp && import.meta.env.PROD && "serviceWorker" in navigator) {
  navigator.serviceWorker.register(import.meta.env.BASE_URL + "sw.js?v=" + APP_VERSION).catch(() => {});
}
