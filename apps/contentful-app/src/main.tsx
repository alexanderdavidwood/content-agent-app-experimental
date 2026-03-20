import React from "react";
import ReactDOM from "react-dom/client";
import { SDKProvider } from "@contentful/react-apps-toolkit";

import App from "./App";

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <SDKProvider>
      <App />
    </SDKProvider>
  </React.StrictMode>,
);
