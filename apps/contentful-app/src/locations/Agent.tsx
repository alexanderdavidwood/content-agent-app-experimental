import { useEffect, useState } from "react";
import { useSDK } from "@contentful/react-apps-toolkit";

import ChatWorkspace from "../components/chat/ChatWorkspace";

export default function Agent() {
  const sdk = useSDK<any>();
  const [surfaceContext, setSurfaceContext] = useState({
    surface: "agent" as const,
    entryId: undefined as string | undefined,
    contentTypeId: undefined as string | undefined,
    lastFocusedFieldId: undefined as string | undefined,
  });

  useEffect(() => {
    const unsubscribeContext = sdk.agent?.onContextChange?.((context: any) => {
      setSurfaceContext({
        surface: "agent",
        entryId: context.metadata?.entryId,
        contentTypeId: context.metadata?.contentTypeId,
        lastFocusedFieldId: context.metadata?.lastFocusedFieldId,
      });
    });

    const unsubscribeToolbar = sdk.agent?.onToolbarAction?.((action: any) => {
      if (action.name === "chat.close") {
        sdk.close?.();
      }
    });

    return () => {
      unsubscribeContext?.();
      unsubscribeToolbar?.();
    };
  }, [sdk]);

  return (
    <ChatWorkspace sdk={sdk} surfaceContext={surfaceContext} />
  );
}
