import type { ApplyResult, ProposedChange } from "@contentful-rename/shared";

type ApprovalState = Record<
  string,
  {
    approved: boolean;
    editedText?: string;
  }
>;

type ReviewPanelProps = {
  changes: ProposedChange[];
  approvals: ApprovalState;
  applyResults: ApplyResult[];
  isApplying: boolean;
  onChangeApproval: (
    changeId: string,
    nextApproval: { approved: boolean; editedText?: string },
  ) => void;
  onApply: () => Promise<void>;
};

export default function ReviewPanel({
  changes,
  approvals,
  applyResults,
  isApplying,
  onChangeApproval,
  onApply,
}: ReviewPanelProps) {
  return (
    <aside style={{ display: "grid", gap: 16 }}>
      <section
        style={{
          border: "1px solid #d1d5db",
          borderRadius: 16,
          padding: 16,
          display: "grid",
          gap: 16,
        }}
      >
        <div>
          <h2 style={{ margin: "0 0 8px" }}>Review proposed changes</h2>
          <p style={{ margin: 0 }}>
            Approve or edit each proposal before any Contentful write is applied.
          </p>
        </div>

        {changes.length === 0 ? (
          <p style={{ margin: 0 }}>No proposals yet. Start a rename run first.</p>
        ) : null}

        {changes.map((change) => {
          const approval = approvals[change.changeId] ?? { approved: false };
          return (
            <article
              key={change.changeId}
              style={{
                border: "1px solid #e5e7eb",
                borderRadius: 12,
                padding: 12,
                display: "grid",
                gap: 10,
              }}
            >
              <div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
                <strong>
                  {change.entryId} / {change.fieldId}
                </strong>
                <span>Confidence {(change.confidence * 100).toFixed(0)}%</span>
              </div>
              <p style={{ margin: 0 }}>{change.reason}</p>
              {change.riskFlags.length > 0 ? (
                <p style={{ margin: 0 }}>
                  Risk flags: {change.riskFlags.join(", ")}
                </p>
              ) : null}
              <label style={{ display: "grid", gap: 6 }}>
                <span>Original</span>
                <textarea readOnly value={change.originalText} />
              </label>
              <label style={{ display: "grid", gap: 6 }}>
                <span>Replacement</span>
                <textarea
                  value={approval.editedText ?? change.proposedText}
                  onChange={(event) =>
                    onChangeApproval(change.changeId, {
                      approved: approval.approved,
                      editedText: event.target.value,
                    })
                  }
                />
              </label>
              <div style={{ display: "flex", gap: 12 }}>
                <button
                  type="button"
                  onClick={() =>
                    onChangeApproval(change.changeId, {
                      approved: true,
                      editedText: approval.editedText,
                    })
                  }
                >
                  Approve
                </button>
                <button
                  type="button"
                  onClick={() =>
                    onChangeApproval(change.changeId, {
                      approved: false,
                      editedText: approval.editedText,
                    })
                  }
                >
                  Reject
                </button>
              </div>
            </article>
          );
        })}

        <button type="button" disabled={isApplying || changes.length === 0} onClick={() => void onApply()}>
          {isApplying ? "Applying approved changes..." : "Apply approved changes"}
        </button>
      </section>

      {applyResults.length > 0 ? (
        <section
          style={{
            border: "1px solid #d1d5db",
            borderRadius: 16,
            padding: 16,
            display: "grid",
            gap: 12,
          }}
        >
          <h2 style={{ margin: 0 }}>Apply results</h2>
          {applyResults.map((result) => (
            <div
              key={`${result.entryId}:${result.status}`}
              style={{ borderBottom: "1px solid #e5e7eb", paddingBottom: 8 }}
            >
              <strong>
                {result.entryId}: {result.status}
              </strong>
              {result.message ? <p style={{ margin: "4px 0 0" }}>{result.message}</p> : null}
            </div>
          ))}
        </section>
      ) : null}
    </aside>
  );
}
