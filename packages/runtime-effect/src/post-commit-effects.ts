import type { PostCommitEffectDelivery, PostCommitEffectPort } from "@panefold/runtime";
import { Effect } from "effect";

export interface EffectPostCommitEffectHandler<Error = never> {
  deliver(delivery: PostCommitEffectDelivery): Effect.Effect<void, Error>;
}

/**
 * Runs optional Effect programs at the runtime's post-commit port. The runtime
 * owns cancellation; Effect receives the same AbortSignal as other adapters.
 */
export function fromEffectPostCommitHandler<Error>(
  handler: EffectPostCommitEffectHandler<Error>,
): PostCommitEffectPort {
  return {
    deliver: (delivery) =>
      Effect.runPromise(handler.deliver(delivery), {
        signal: delivery.signal,
      }),
  };
}
