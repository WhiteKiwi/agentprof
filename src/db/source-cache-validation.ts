import { fields, identity, invalid } from "./source-validation.js";

export type SourceCacheEvidence = Readonly<{ contractVersion: 1; contentFingerprint: string }>;
export function validateCacheEvidence(value: unknown, keyId: string): SourceCacheEvidence {
  const v = fields(value, ["contractVersion", "contentFingerprint"]);
  if (v["contractVersion"] !== 1) invalid();
  return Object.freeze({ contractVersion: 1, contentFingerprint: identity(v["contentFingerprint"], "content", keyId) });
}
