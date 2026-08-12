# ADR-0010: Executable evidence taxonomy and certification manifests

Status: Accepted

## Context

A file hash proves which bytes were reviewed, not that a browser run passed, a physical workload
met its budget, a screen-reader task succeeded, or an independent assessor approved a release.
Earlier conformance metadata could account for requirements while still blurring source, executed
result, and attestation.

## Decision

Every requirement/profile trace declares one verification class:

- **A — code-verifiable:** static, model, unit, property, schema, or repository-result proof;
- **B — environment-verifiable:** automated browser, framework, storage, recovery, or workload run;
- **C — manual/external:** physical hardware, assistive technology, usability, independent review,
  third-party adoption, or signed approval;
- **D — future scope:** a profile-scoped capability the current profile does not publish.

Evidence separately declares whether its artifact is source, an executed result, or an attestation.
Verified repository URIs are content-addressed and checked against bytes in the tree. Each hard gate
declares exact requirement/profile scope and minimum evidence classes. A stable manifest fails
validation unless every applicable trace and gate is verified.

Third-party adapters and plugins use a public Draft 2020-12 certification manifest containing exact
subject, engine, protocol, framework/browser, profile, immutable artifacts, and approval metadata.
`candidate` records are informative; `certified` records require a signed, content-addressed
approval whose timestamp follows the evidence.

## Consequences

- Source code cannot masquerade as a browser result or manual assessment.
- Unsupported product scope stays visible without weakening universal requirements.
- Experimental releases may publish blocked/unresolved reports; stable releases may not waive them.
- External evidence remains work performed by real people and systems, not a status generated to
  make CI green.
