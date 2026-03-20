export const CONTENTFUL_TEXT_FIELD_TYPES = ["Symbol", "Text"] as const;
export const CONTENTFUL_RICH_TEXT_FIELD_TYPES = ["RichText"] as const;
export const CONTENTFUL_SUPPORTED_FIELD_TYPES = [
  ...CONTENTFUL_TEXT_FIELD_TYPES,
  ...CONTENTFUL_RICH_TEXT_FIELD_TYPES,
] as const;

export type ContentfulSupportedFieldType =
  (typeof CONTENTFUL_SUPPORTED_FIELD_TYPES)[number];

export const APPLY_RESULT_STATUSES = [
  "APPLIED",
  "SKIPPED",
  "CONFLICT",
  "FAILED",
] as const;

export type ApplyResultStatus = (typeof APPLY_RESULT_STATUSES)[number];

export const RISK_FLAGS = [
  "LEGAL_CONTEXT",
  "CODE_SNIPPET",
  "TABLE_CONTENT",
  "UNCERTAIN_VARIANT",
  "LIKELY_FALSE_POSITIVE",
  "MANUAL_REVIEW_REQUIRED",
] as const;

export type RiskFlag = (typeof RISK_FLAGS)[number];
