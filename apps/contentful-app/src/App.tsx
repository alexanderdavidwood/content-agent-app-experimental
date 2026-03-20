import type { ComponentType } from "react";
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
  return <Component />;
}
