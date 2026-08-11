import type {
  CommandEnvelope,
  CommandRejection,
  WorkspaceCommand,
  WorkspaceSnapshot,
} from "@panefold/model";

export type PolicyDecision =
  | { readonly kind: "allow"; readonly command: WorkspaceCommand }
  | { readonly kind: "deny"; readonly code: string; readonly reason: string }
  | {
      readonly kind: "transform";
      readonly command: WorkspaceCommand;
      readonly reason: string;
    };

export interface WorkspacePolicy {
  readonly id: string;
  readonly priority: number;
  evaluate(
    snapshot: WorkspaceSnapshot,
    envelope: CommandEnvelope,
    command: WorkspaceCommand,
  ): PolicyDecision;
}

export type PolicyResult =
  | { readonly ok: true; readonly command: WorkspaceCommand }
  | { readonly ok: false; readonly error: CommandRejection };

const MAX_TRANSFORMS = 16;

export function evaluatePolicies(
  snapshot: WorkspaceSnapshot,
  envelope: CommandEnvelope,
  policies: readonly WorkspacePolicy[],
): PolicyResult {
  const ordered = [...policies].sort(
    (left, right) =>
      left.priority - right.priority || (left.id < right.id ? -1 : left.id > right.id ? 1 : 0),
  );
  let command: WorkspaceCommand = envelope.command;
  const seen = new Set<string>();

  for (let transformCount = 0; transformCount <= MAX_TRANSFORMS; transformCount += 1) {
    let transformed = false;

    for (const policy of ordered) {
      const decision = policy.evaluate(snapshot, envelope, command);
      if (decision.kind === "deny") {
        return {
          ok: false,
          error: {
            code: "CAPABILITY_DENIED",
            message: decision.reason,
            remediation: ["Choose another destination", "Keep the current workspace arrangement"],
            commandId: envelope.id,
            revision: snapshot.revision,
            details: { policyId: policy.id, policyCode: decision.code },
          },
        };
      }
      if (decision.kind === "transform") {
        const signature = stableCommandSignature(decision.command);
        if (seen.has(signature) || transformCount === MAX_TRANSFORMS) {
          return {
            ok: false,
            error: {
              code: "INVALID_COMMAND",
              message: "Policy transforms did not converge to one deterministic command.",
              remediation: ["Review policy order and transform rules"],
              commandId: envelope.id,
              revision: snapshot.revision,
              details: { policyId: policy.id },
            },
          };
        }
        seen.add(signature);
        command = decision.command;
        transformed = true;
        break;
      }
    }

    if (!transformed) {
      return { ok: true, command };
    }
  }

  throw new Error("Unreachable policy evaluation state");
}

function stableCommandSignature(command: WorkspaceCommand): string {
  return JSON.stringify(command, (_key, value: unknown) =>
    typeof value === "bigint" ? value.toString() : value,
  );
}
