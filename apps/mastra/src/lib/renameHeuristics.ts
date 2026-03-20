import type {
  CandidateEntrySnapshot,
  DiscoveryQueryPlan,
  ProposedChange,
  RenameRunInput,
  RiskFlag,
} from "@contentful-rename/shared";

function escapeRegex(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function buildVariants(oldName: string) {
  const base = oldName.trim();
  const variants = new Set<string>([
    base,
    `${base}s`,
    `${base}'s`,
    `${base}’s`,
    base.replace(/\s+/g, "-"),
    base.replace(/-/g, " "),
  ]);

  return [...variants].filter(Boolean);
}

export function buildHeuristicDiscoveryPlan(
  input: RenameRunInput,
): DiscoveryQueryPlan {
  const variants = buildVariants(input.oldProductName);
  const queries = [
    input.oldProductName,
    ...variants
      .filter((variant) => variant !== input.oldProductName)
      .slice(0, 2),
    `${input.oldProductName} product`,
    `${input.oldProductName} feature`,
  ].slice(0, 5);

  return {
    queries,
    aliases: variants,
    ignorePatterns: input.userNotes?.match(/skip [^.]+/gi) ?? [],
    riskNotes: [
      "Semantic search returns a maximum of 10 entries per query in beta.",
      "Legal disclaimers and code-like snippets should be reviewed manually.",
    ],
  };
}

function detectRiskFlags(text: string): RiskFlag[] {
  const flags: RiskFlag[] = [];
  if (/\b(copyright|trademark|legal|terms)\b/i.test(text)) {
    flags.push("LEGAL_CONTEXT");
  }
  if (/[{}<>]|const |function |\bapi\b/i.test(text)) {
    flags.push("CODE_SNIPPET");
  }
  if (/\|/.test(text)) {
    flags.push("TABLE_CONTENT");
  }

  return flags;
}

function replaceFirstMatchingVariant(
  text: string,
  input: RenameRunInput,
): string | null {
  for (const variant of buildVariants(input.oldProductName)) {
    const expression = new RegExp(escapeRegex(variant), "gi");
    if (expression.test(text)) {
      return text.replace(expression, input.newProductName);
    }
  }

  return null;
}

export function buildHeuristicProposals(
  input: RenameRunInput,
  candidates: CandidateEntrySnapshot[],
): ProposedChange[] {
  const proposals: ProposedChange[] = [];

  for (const candidate of candidates) {
    for (const field of candidate.fields) {
      if (field.fieldType === "RichText") {
        for (const segment of field.segments) {
          const proposedText = replaceFirstMatchingVariant(segment.text, input);
          if (!proposedText || proposedText === segment.text) {
            continue;
          }

          proposals.push({
            changeId: `${candidate.entryId}:${field.fieldId}:${segment.segmentId}`,
            entryId: candidate.entryId,
            fieldId: field.fieldId,
            locale: field.locale,
            segmentId: segment.segmentId,
            originalText: segment.text,
            proposedText,
            reason: "Detected a likely lexical product-name match in rich text.",
            confidence: 0.58,
            riskFlags: detectRiskFlags(segment.text),
          });
        }
        continue;
      }

      if (typeof field.rawValue !== "string") {
        continue;
      }

      const proposedText = replaceFirstMatchingVariant(field.rawValue, input);
      if (!proposedText || proposedText === field.rawValue) {
        continue;
      }

      proposals.push({
        changeId: `${candidate.entryId}:${field.fieldId}:${field.locale}`,
        entryId: candidate.entryId,
        fieldId: field.fieldId,
        locale: field.locale,
        originalText: field.rawValue,
        proposedText,
        reason: "Detected a likely lexical product-name match in text content.",
        confidence: 0.62,
        riskFlags: detectRiskFlags(field.rawValue),
      });
    }
  }

  return proposals;
}
