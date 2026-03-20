import type {
  ApplyResult,
  ApprovedChange,
  CandidateEntrySnapshot,
  DiscoveryQueryPlan,
  ProposedChange,
  RenameRunInput,
} from "@contentful-rename/shared";

export type RenameRunRecord = {
  runId: string;
  createdAt: string;
  updatedAt: string;
  input: RenameRunInput;
  discoveryPlan: DiscoveryQueryPlan;
  candidates: CandidateEntrySnapshot[];
  proposedChanges: ProposedChange[];
  approvals: ApprovedChange[];
  results: ApplyResult[];
  status:
    | "created"
    | "discovered"
    | "awaiting-approval"
    | "approved"
    | "completed";
};

class InMemoryRunStore {
  private readonly runs = new Map<string, RenameRunRecord>();

  async get(runId: string) {
    return this.runs.get(runId) ?? null;
  }

  async upsert(record: RenameRunRecord) {
    this.runs.set(record.runId, record);
    return record;
  }
}

declare global {
  // eslint-disable-next-line no-var
  var __contentfulRenameRunStore__: InMemoryRunStore | undefined;
}

export const runStore =
  globalThis.__contentfulRenameRunStore__ ??
  (globalThis.__contentfulRenameRunStore__ = new InMemoryRunStore());
