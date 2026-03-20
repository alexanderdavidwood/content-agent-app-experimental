import { useSDK } from "@contentful/react-apps-toolkit";

import ChatWorkspace from "../components/chat/ChatWorkspace";

export default function Page() {
  const sdk = useSDK<any>();

  return <ChatWorkspace sdk={sdk} surfaceContext={{ surface: "page" }} />;
}
