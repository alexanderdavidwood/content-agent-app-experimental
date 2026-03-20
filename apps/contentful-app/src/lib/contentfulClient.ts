import { createClient } from "contentful-management";

import type {
  AgentSurfaceContext,
  ApplyOperation,
  ApplyResult,
  CandidateEntrySnapshot,
  CandidateFieldSnapshot,
  ProposedChange,
  RenameRunInput,
  RichTextNode,
} from "@contentful-rename/shared";
import {
  appInstallationParametersSchema,
  extractRichTextSegments,
} from "@contentful-rename/shared";

import { applyProposedRichTextChange, groupOperationsByEntry } from "./richTextPatch";

type EntryLike = {
  sys: {
    id: string;
    version: number;
    updatedAt: string;
    contentType: {
      sys: {
        id: string;
      };
    };
  };
  fields: Record<string, Record<string, unknown>>;
};

type ContentTypeLike = {
  fields: Array<{
    id: string;
    type: string;
  }>;
};

type SdkLike = {
  cmaAdapter: unknown;
  cma?: unknown;
  ids: {
    space: string;
    environment?: string;
    environmentAlias?: string;
  };
  parameters: {
    installation?: unknown;
  };
};

export function getInstallationParameters(sdk: SdkLike) {
  return appInstallationParametersSchema.parse(sdk.parameters.installation ?? {});
}

export function createCmaClient(sdk: SdkLike) {
  return createClient(
    { apiAdapter: sdk.cmaAdapter as never },
    {
      type: "plain",
      defaults: {
        spaceId: sdk.ids.space,
        environmentId: sdk.ids.environmentAlias ?? sdk.ids.environment ?? "master",
      },
    },
  );
}

export async function fetchEntrySnapshots(
  sdk: SdkLike,
  entryIds: string[],
  locale: string,
  allowedContentTypeIds: string[],
): Promise<CandidateEntrySnapshot[]> {
  const cma = createCmaClient(sdk);
  const contentTypeCache = new Map<string, ContentTypeLike>();
  const snapshots: CandidateEntrySnapshot[] = [];

  for (const entryId of entryIds) {
    const entry = (await (cma as any).entry.get({ entryId })) as EntryLike;
    const contentTypeId = entry.sys.contentType.sys.id;

    if (
      allowedContentTypeIds.length > 0 &&
      !allowedContentTypeIds.includes(contentTypeId)
    ) {
      continue;
    }

    let contentType = contentTypeCache.get(contentTypeId);
    if (!contentType) {
      contentType = (await (cma as any).contentType.get({
        contentTypeId,
      })) as ContentTypeLike;
      contentTypeCache.set(contentTypeId, contentType);
    }

    const fields = contentType.fields.flatMap((field) =>
      snapshotField(entry, field.id, field.type, locale),
    );

    if (fields.length === 0) {
      continue;
    }

    snapshots.push({
      entryId: entry.sys.id,
      contentTypeId,
      version: entry.sys.version,
      updatedAt: entry.sys.updatedAt,
      fields,
    });
  }

  return snapshots;
}

function snapshotField(
  entry: EntryLike,
  fieldId: string,
  fieldType: string,
  locale: string,
): CandidateFieldSnapshot[] {
  const localizedValue = entry.fields[fieldId]?.[locale];
  if (localizedValue === undefined || localizedValue === null) {
    return [];
  }

  if (fieldType === "Symbol" || fieldType === "Text") {
    return [
      {
        fieldId,
        locale,
        fieldType,
        rawValue: localizedValue,
        segments: [],
      },
    ];
  }

  if (fieldType === "RichText") {
    return [
      {
        fieldId,
        locale,
        fieldType,
        rawValue: localizedValue,
        segments: extractRichTextSegments(fieldId, localizedValue as RichTextNode),
      },
    ];
  }

  return [];
}

export function buildDefaultRenameInput(
  surfaceContext: AgentSurfaceContext,
  locale: string,
): RenameRunInput {
  return {
    oldProductName: "",
    newProductName: "",
    defaultLocale: locale,
    searchMode: "semantic",
    contentTypeIds: [],
    surfaceContext,
  };
}

export function buildApplyOperations(
  snapshots: CandidateEntrySnapshot[],
  changes: ProposedChange[],
  approvals: Record<string, { approved: boolean; editedText?: string }>,
): ApplyOperation[] {
  const snapshotLookup = new Map(
    snapshots.map((snapshot) => [snapshot.entryId, snapshot] as const),
  );

  const operations: ApplyOperation[] = [];

  for (const change of changes) {
    const approval = approvals[change.changeId];
    if (!approval?.approved) {
      continue;
    }

    const snapshot = snapshotLookup.get(change.entryId);
    const field = snapshot?.fields.find(
      (candidate) =>
        candidate.fieldId === change.fieldId && candidate.locale === change.locale,
    );

    if (!snapshot || !field) {
      continue;
    }

    const nextText = approval.editedText ?? change.proposedText;
    let nextValue: unknown = nextText;

    if (field.fieldType === "RichText") {
      nextValue = applyProposedRichTextChange(
        field.rawValue as RichTextNode,
        change,
        nextText,
      );
    }

    operations.push({
      entryId: snapshot.entryId,
      version: snapshot.version,
      fieldId: change.fieldId,
      locale: change.locale,
      segmentId: change.segmentId,
      nextValue,
    });
  }

  return operations;
}

export async function applyOperations(
  sdk: SdkLike,
  operations: ApplyOperation[],
): Promise<ApplyResult[]> {
  const cma = createCmaClient(sdk);
  const grouped = groupOperationsByEntry(operations);
  const results: ApplyResult[] = [];

  for (const [entryId, entryOperations] of Object.entries(grouped)) {
    try {
      let entry = (await (cma as any).entry.get({ entryId })) as EntryLike;

      for (let attempt = 0; attempt < 2; attempt += 1) {
        try {
          const nextFields = structuredClone(entry.fields);

          for (const operation of entryOperations) {
            nextFields[operation.fieldId] = nextFields[operation.fieldId] ?? {};
            nextFields[operation.fieldId][operation.locale] = operation.nextValue;
          }

          entry = (await (cma as any).entry.update(
            { entryId },
            {
              fields: nextFields,
              sys: {
                version: entry.sys.version,
              },
            },
          )) as EntryLike;

          results.push({
            entryId,
            status: "APPLIED",
            newVersion: entry.sys.version,
            message: `Updated ${entryOperations.length} approved change(s)`,
          });
          break;
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);

          if (attempt === 0 && message.includes("VersionMismatch")) {
            entry = (await (cma as any).entry.get({ entryId })) as EntryLike;
            continue;
          }

          results.push({
            entryId,
            status: message.includes("VersionMismatch") ? "CONFLICT" : "FAILED",
            message,
          });
          break;
        }
      }
    } catch (error) {
      results.push({
        entryId,
        status: "FAILED",
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return results;
}

export async function invokeAppAction<TInput, TResult>(
  sdk: any,
  actionName: string,
  payload: TInput,
): Promise<TResult> {
  const api = sdk.appAction ?? sdk.appActions ?? sdk.cma?.appAction;
  const invoke = api?.callAppAction ?? api?.call ?? api?.run;

  if (!invoke) {
    throw new Error("App Action API is not available in this Contentful SDK context");
  }

  return invoke(actionName, payload) as Promise<TResult>;
}
