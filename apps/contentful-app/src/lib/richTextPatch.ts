import type {
  ApplyOperation,
  ProposedChange,
  RichTextNode,
  RichTextSegment,
} from "@contentful-rename/shared";
import {
  extractRichTextSegments,
  updateRichTextSegment,
} from "@contentful-rename/shared";

export function applyProposedRichTextChange(
  document: RichTextNode,
  change: ProposedChange,
  nextText: string,
): RichTextNode {
  if (!change.segmentId) {
    throw new Error("Rich text change is missing a segment id");
  }

  const segments = extractRichTextSegments(change.fieldId, document);
  const segment = segments.find(
    (candidate) => candidate.segmentId === change.segmentId,
  );

  if (!segment) {
    throw new Error(`Could not find segment ${change.segmentId}`);
  }

  return updateRichTextSegment(document, segment.path, nextText);
}

export function buildSegmentLookup(
  fieldId: string,
  document: RichTextNode,
): Map<string, RichTextSegment> {
  const lookup = new Map<string, RichTextSegment>();

  for (const segment of extractRichTextSegments(fieldId, document)) {
    lookup.set(segment.segmentId, segment);
  }

  return lookup;
}

export function groupOperationsByEntry(operations: ApplyOperation[]) {
  return operations.reduce<Record<string, ApplyOperation[]>>((acc, operation) => {
    const existing = acc[operation.entryId] ?? [];
    existing.push(operation);
    acc[operation.entryId] = existing;
    return acc;
  }, {});
}
