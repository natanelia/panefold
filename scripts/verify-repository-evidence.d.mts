export interface RepositoryEvidenceRecord {
  readonly id: string;
  readonly status: string;
  readonly artifactRole: string;
  readonly uri?: string;
  readonly sha256?: string;
}

export function verifyRepositoryEvidence(
  evidence: readonly RepositoryEvidenceRecord[],
  options?: Readonly<{
    readonly root?: string;
    readonly allowMissingResultSourceDigestIds?: readonly string[];
  }>,
): Promise<readonly string[]>;
