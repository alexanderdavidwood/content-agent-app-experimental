import { useState } from "react";

import type { RenameRunInput } from "@contentful-rename/shared";

type QuickStartArtifactProps = {
  defaultLocale: string;
  onStart: (input: RenameRunInput) => Promise<void>;
};

export default function QuickStartArtifact({
  defaultLocale,
  onStart,
}: QuickStartArtifactProps) {
  const [oldProductName, setOldProductName] = useState("");
  const [newProductName, setNewProductName] = useState("");
  const [userNotes, setUserNotes] = useState("");
  const [contentTypeIds, setContentTypeIds] = useState("");
  const [isStarting, setIsStarting] = useState(false);

  return (
    <form
      onSubmit={async (event) => {
        event.preventDefault();
        setIsStarting(true);
        try {
          await onStart({
            oldProductName,
            newProductName,
            defaultLocale,
            contentTypeIds: contentTypeIds
              .split(",")
              .map((value) => value.trim())
              .filter(Boolean),
            userNotes: userNotes.trim() || undefined,
          });
        } finally {
          setIsStarting(false);
        }
      }}
      style={{ display: "grid", gap: 12 }}
    >
      <label style={{ display: "grid", gap: 6 }}>
        <span>Current product name</span>
        <input
          required
          value={oldProductName}
          onChange={(event) => setOldProductName(event.target.value)}
        />
      </label>
      <label style={{ display: "grid", gap: 6 }}>
        <span>New product name</span>
        <input
          required
          value={newProductName}
          onChange={(event) => setNewProductName(event.target.value)}
        />
      </label>
      <label style={{ display: "grid", gap: 6 }}>
        <span>Limit to content types</span>
        <input
          placeholder="page, promoBanner, product"
          value={contentTypeIds}
          onChange={(event) => setContentTypeIds(event.target.value)}
        />
      </label>
      <label style={{ display: "grid", gap: 6 }}>
        <span>Notes for the agent</span>
        <textarea
          value={userNotes}
          onChange={(event) => setUserNotes(event.target.value)}
          placeholder="Skip legal disclaimers or legacy names in code snippets."
        />
      </label>
      <button type="submit" disabled={isStarting}>
        {isStarting ? "Starting run..." : "Start semantic scan"}
      </button>
    </form>
  );
}
