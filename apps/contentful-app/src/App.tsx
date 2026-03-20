import { Component } from "react";
import type { ComponentType, ErrorInfo, ReactNode } from "react";
import { locations } from "@contentful/app-sdk";
import { useSDK } from "@contentful/react-apps-toolkit";

import Agent from "./locations/Agent";
import Config from "./locations/Config";
import Page from "./locations/Page";

type LocationComponent = ComponentType;

const AGENT_LOCATION =
  ((locations as unknown as Record<string, string>).LOCATION_AGENT ??
    "location:agent") as string;

const componentByLocation: Record<string, LocationComponent> = {
  [locations.LOCATION_PAGE]: Page,
  [locations.LOCATION_APP_CONFIG]: Config,
  [AGENT_LOCATION]: Agent,
};

class AppErrorBoundary extends Component<
  { children: ReactNode },
  { error: Error | null }
> {
  state = { error: null as Error | null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error("App location render failed", error, errorInfo);
  }

  render() {
    if (this.state.error) {
      return (
        <main style={{ padding: 24, fontFamily: "system-ui, sans-serif" }}>
          <h1>App failed to render</h1>
          <p style={{ marginBottom: 8 }}>
            {this.state.error.message || "Unknown rendering error."}
          </p>
          <p style={{ margin: 0 }}>
            Please refresh this page. If this persists, re-open the app location
            from Contentful and ensure installation parameters are saved.
          </p>
        </main>
      );
    }

    return this.props.children;
  }
}

export default function App() {
  const sdk = useSDK();

  const activeLocation = Object.keys(componentByLocation).find((locationName) =>
    sdk.location.is(locationName),
  );

  if (!activeLocation) {
    return (
      <main style={{ padding: 24, fontFamily: "system-ui, sans-serif" }}>
        <h1>Unsupported app location</h1>
        <p>
          This app currently supports the `Page`, `App configuration`, and
          optional `Agent` locations.
        </p>
      </main>
    );
  }

  const Component = componentByLocation[activeLocation];
  return (
    <AppErrorBoundary>
      <Component />
    </AppErrorBoundary>
  );
}
