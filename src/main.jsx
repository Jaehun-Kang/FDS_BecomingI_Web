import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import "./styles/index.css";
import App from "./App.jsx";
import { installExperimentSettings } from "./experiments/transformSettings.js";
const stopExperimentSettings = installExperimentSettings();
import.meta.hot?.dispose(stopExperimentSettings);
import { observeDevelopmentTiming } from "./services/developmentTiming.js";

if (import.meta.env.DEV) {
  const stop = observeDevelopmentTiming(window.performance, window.PerformanceObserver);
  import.meta.hot?.dispose(stop);
}

const navigationEntry = performance.getEntriesByType("navigation")[0];

if (navigationEntry?.type === "reload" && window.location.pathname === "/") {
  window.history.replaceState(window.history.state, "", "/profile-setting");
}

createRoot(document.getElementById("root")).render(
  <BrowserRouter>
    <App />
  </BrowserRouter>,
);
