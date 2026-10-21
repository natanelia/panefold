import { validateBoundaryValue, type BoundaryLimits } from "./boundary";

export type PanelContextMode = "follow" | "locked";
export type PanelContextKey<Channels> = Extract<keyof Channels, string>;

export interface PanelContextEvent<Value, Channel extends string = string> {
  readonly sequence: number;
  readonly channel: Channel;
  readonly value: Value;
  readonly sourcePanelId: string;
  readonly groupId: string;
}

export type PanelContextValues<Channels> = {
  readonly [Key in PanelContextKey<Channels>]?: PanelContextEvent<Channels[Key], Key>;
};

export interface PanelContextSnapshot<Channels> {
  readonly panelId: string;
  readonly groupId: string;
  readonly mode: PanelContextMode;
  readonly connected: boolean;
  readonly contexts: PanelContextValues<Channels>;
}

export type PanelContextPublishResult<Value, Channel extends string = string> =
  | { readonly status: "published"; readonly event: PanelContextEvent<Value, Channel> }
  | { readonly status: "ignored"; readonly reason: "unchanged" | "echo" }
  | {
      readonly status: "rejected";
      readonly reason:
        | "disposed"
        | "locked"
        | "reentrant"
        | "invalid-channel"
        | "invalid-value"
        | "invalid-cause"
        | "sequence-exhausted";
    };

export interface PanelContextPublishOptions {
  /** Pass the received event for an event-derived update, including async echoes. */
  readonly cause?: PanelContextEvent<unknown>;
}

export interface PanelContextConnection<Channels extends object> {
  readonly getSnapshot: () => PanelContextSnapshot<Channels>;
  /** Subscription does not own membership. Dispose the connection separately. */
  readonly subscribe: (listener: () => void) => () => void;
  readonly publish: <Key extends PanelContextKey<Channels>>(
    channel: Key,
    value: Channels[Key],
    options?: PanelContextPublishOptions,
  ) => PanelContextPublishResult<Channels[Key], Key>;
  readonly setMode: (mode: PanelContextMode) => void;
  /** Explicit group changes adopt the destination context, even when locked. */
  readonly setGroup: (groupId: string) => void;
  readonly dispose: () => void;
}

export interface PanelContextHubOptions<Channels extends object> {
  readonly channels: {
    readonly [Key in PanelContextKey<Channels>]: (value: unknown) => value is Channels[Key];
  };
  readonly maxGroups?: number;
  readonly maxPanels?: number;
  readonly maxSubscribersPerPanel?: number;
  readonly valueLimits?: Partial<BoundaryLimits>;
  /** Redacted notification; subscriber exceptions never roll back a published value. */
  readonly onSubscriberError?: (panelId: string) => void;
}

export interface PanelContextHub<Channels extends object> {
  readonly connect: (options: {
    readonly panelId: string;
    readonly groupId: string;
    readonly mode?: PanelContextMode;
  }) => PanelContextConnection<Channels>;
  readonly getStats: () => Readonly<{ groups: number; panels: number; subscribers: number }>;
  readonly dispose: () => void;
}

interface ContextMember<Channels> {
  snapshot: PanelContextSnapshot<Channels>;
  readonly listeners: Set<() => void>;
}

interface ContextGroup<Channels> {
  contexts: PanelContextValues<Channels>;
  readonly fingerprints: Map<string, string>;
  readonly members: Set<ContextMember<Channels>>;
}

/**
 * Same-realm, application-owned context. This hub never dispatches a layout
 * command, stores domain documents, performs I/O, or changes workspace history.
 */
export function createPanelContextHub<Channels extends object>(
  options: PanelContextHubOptions<Channels>,
): PanelContextHub<Channels> {
  const maxGroups = limit(options.maxGroups ?? 64, "maxGroups");
  const maxPanels = limit(options.maxPanels ?? 256, "maxPanels");
  const maxSubscribers = limit(options.maxSubscribersPerPanel ?? 64, "maxSubscribersPerPanel");
  const validators = new Map<string, (value: unknown) => boolean>(Object.entries(options.channels));
  if (validators.size === 0 || validators.size > 32) {
    throw new RangeError("A context hub requires 1 to 32 named channels");
  }
  for (const [name, validator] of validators) {
    identifier(name);
    if (typeof validator !== "function") {
      throw new TypeError("Channel validators must be functions");
    }
  }
  const valueLimits = Object.freeze({
    maxDepth: 16,
    maxNodes: 512,
    maxArrayLength: 128,
    maxObjectKeys: 64,
    maxStringLength: 4_096,
    maxTotalStringLength: 16_384,
    ...options.valueLimits,
  });
  validateBoundaryValue(null, valueLimits);
  const onSubscriberError = options.onSubscriberError;
  const groups = new Map<string, ContextGroup<Channels>>();
  const members = new Map<string, ContextMember<Channels>>();
  // Weak membership proves that a cause came from this hub, without retaining history.
  const issuedEvents = new WeakSet<object>();
  let sequence = 0;
  let disposed = false;
  let busy = false;

  const assertMutable = () => {
    if (disposed) throw new Error("Panel context hub is disposed");
    if (busy) throw new Error("Context mutation during validation or notification is not allowed");
  };
  const assertMember = (member: ContextMember<Channels>) => {
    assertMutable();
    if (!member.snapshot.connected) throw new Error("Panel context connection is disposed");
  };
  const groupFor = (id: string): ContextGroup<Channels> => {
    let group = groups.get(id);
    if (group === undefined) {
      group = { contexts: emptyContexts<Channels>(), fingerprints: new Map(), members: new Set() };
      groups.set(id, group);
    }
    return group;
  };
  const detach = (member: ContextMember<Channels>) => {
    const group = groups.get(member.snapshot.groupId);
    group?.members.delete(member);
    if (group?.members.size === 0) groups.delete(member.snapshot.groupId);
  };
  const disconnect = (member: ContextMember<Channels>) => {
    if (!member.snapshot.connected) return;
    detach(member);
    members.delete(member.snapshot.panelId);
    member.snapshot = Object.freeze({
      ...member.snapshot,
      connected: false,
      contexts: emptyContexts<Channels>(),
    });
    member.listeners.clear();
  };
  const notify = (targets: readonly ContextMember<Channels>[]) => {
    busy = true;
    try {
      for (const member of targets) {
        for (const listener of [...member.listeners]) {
          if (!member.snapshot.connected || !member.listeners.has(listener)) continue;
          try {
            listener();
          } catch {
            try {
              onSubscriberError?.(member.snapshot.panelId);
            } catch {
              // Error reporting is observational, not a second failure channel.
            }
          }
        }
      }
    } finally {
      busy = false;
    }
  };

  const connect: PanelContextHub<Channels>["connect"] = (input) => {
    assertMutable();
    identifier(input.panelId);
    identifier(input.groupId);
    const mode = input.mode ?? "follow";
    validateMode(mode);
    if (members.has(input.panelId)) throw new Error("A panel can join a context hub only once");
    if (members.size >= maxPanels) throw new RangeError("Panel context member limit exceeded");
    if (!groups.has(input.groupId) && groups.size >= maxGroups) {
      throw new RangeError("Panel context group limit exceeded");
    }
    const group = groupFor(input.groupId);
    const member: ContextMember<Channels> = {
      snapshot: Object.freeze({
        panelId: input.panelId,
        groupId: input.groupId,
        mode,
        connected: true,
        contexts: group.contexts,
      }),
      listeners: new Set(),
    };
    members.set(input.panelId, member);
    group.members.add(member);

    const publish: PanelContextConnection<Channels>["publish"] = (
      channel,
      value,
      publication = {},
    ) => {
      if (disposed || !member.snapshot.connected) return { status: "rejected", reason: "disposed" };
      if (busy) return { status: "rejected", reason: "reentrant" };
      if (member.snapshot.mode === "locked") return { status: "rejected", reason: "locked" };
      const validate = validators.get(channel);
      if (validate === undefined) return { status: "rejected", reason: "invalid-channel" };
      const cause = publication.cause;
      if (cause !== undefined) {
        if (
          cause === null ||
          typeof cause !== "object" ||
          !issuedEvents.has(cause) ||
          cause.channel !== channel ||
          cause.groupId !== member.snapshot.groupId
        ) {
          return { status: "rejected", reason: "invalid-cause" };
        }
        return { status: "ignored", reason: "echo" };
      }

      let owned: Channels[typeof channel];
      let fingerprint: string;
      busy = true;
      try {
        if (!validateBoundaryValue(value, valueLimits).ok) {
          return { status: "rejected", reason: "invalid-value" };
        }
        owned = structuredClone(value);
        if (!validateBoundaryValue(owned, valueLimits).ok) {
          return { status: "rejected", reason: "invalid-value" };
        }
        freezeValue(owned);
        if (!validate(owned)) return { status: "rejected", reason: "invalid-value" };
        fingerprint = canonicalValue(owned);
      } catch {
        return { status: "rejected", reason: "invalid-value" };
      } finally {
        busy = false;
      }
      // A trusted validator can still dispose its owner. Do not revive that membership.
      if (disposed || !member.snapshot.connected) return { status: "rejected", reason: "disposed" };
      const destination = groups.get(member.snapshot.groupId);
      if (destination === undefined) return { status: "rejected", reason: "disposed" };
      if (destination.fingerprints.get(channel) === fingerprint) {
        return { status: "ignored", reason: "unchanged" };
      }
      if (sequence === Number.MAX_SAFE_INTEGER) {
        return { status: "rejected", reason: "sequence-exhausted" };
      }
      sequence += 1;
      const event = Object.freeze({
        sequence,
        channel,
        value: owned,
        sourcePanelId: member.snapshot.panelId,
        groupId: member.snapshot.groupId,
      });
      issuedEvents.add(event);
      destination.fingerprints.set(channel, fingerprint);
      const contexts = Object.assign(emptyMutableContexts<Channels>(), destination.contexts);
      Object.defineProperty(contexts, channel, { value: event, enumerable: true });
      destination.contexts = Object.freeze(contexts);
      const targets = [...destination.members].filter(
        (target) => target.snapshot.mode === "follow",
      );
      // Install all snapshots before notifying anyone: observers cannot see partial fan-out.
      for (const target of targets) {
        target.snapshot = Object.freeze({ ...target.snapshot, contexts: destination.contexts });
      }
      notify(targets);
      return { status: "published", event };
    };

    return Object.freeze({
      getSnapshot: () => member.snapshot,
      subscribe: (listener: () => void) => {
        if (disposed || !member.snapshot.connected) return () => {};
        if (member.listeners.size >= maxSubscribers) {
          throw new RangeError("Panel context subscriber limit exceeded");
        }
        // Each subscription has its own lease, even for the same callback.
        const subscription = () => listener();
        member.listeners.add(subscription);
        return () => {
          member.listeners.delete(subscription);
        };
      },
      publish,
      setMode: (next: PanelContextMode) => {
        assertMember(member);
        validateMode(next);
        if (member.snapshot.mode === next) return;
        member.snapshot = Object.freeze({
          ...member.snapshot,
          mode: next,
          contexts:
            next === "follow"
              ? groupFor(member.snapshot.groupId).contexts
              : member.snapshot.contexts,
        });
        notify([member]);
      },
      setGroup: (next: string) => {
        assertMember(member);
        identifier(next);
        if (member.snapshot.groupId === next) return;
        const previous = groups.get(member.snapshot.groupId);
        const releasesGroup = previous?.members.size === 1;
        if (!groups.has(next) && groups.size - Number(releasesGroup) >= maxGroups) {
          throw new RangeError("Panel context group limit exceeded");
        }
        detach(member);
        const destination = groupFor(next);
        destination.members.add(member);
        member.snapshot = Object.freeze({
          ...member.snapshot,
          groupId: next,
          contexts: destination.contexts,
        });
        notify([member]);
      },
      dispose: () => disconnect(member),
    });
  };

  return Object.freeze({
    connect,
    getStats: () =>
      Object.freeze({
        groups: groups.size,
        panels: members.size,
        subscribers: [...members.values()].reduce(
          (count, member) => count + member.listeners.size,
          0,
        ),
      }),
    dispose: () => {
      if (disposed) return;
      disposed = true;
      for (const member of [...members.values()]) disconnect(member);
    },
  });
}

function emptyMutableContexts<Channels>(): PanelContextValues<Channels> {
  return Object.create(null) as PanelContextValues<Channels>;
}

function emptyContexts<Channels>(): PanelContextValues<Channels> {
  return Object.freeze(emptyMutableContexts<Channels>());
}

function identifier(value: string): void {
  if (typeof value !== "string" || value.trim().length === 0 || value.length > 128) {
    throw new TypeError("Context identifiers must contain 1 to 128 characters");
  }
}

function validateMode(mode: PanelContextMode): void {
  if (mode !== "follow" && mode !== "locked") throw new TypeError("Unknown panel context mode");
}

function limit(value: number, name: string): number {
  if (!Number.isSafeInteger(value) || value < 1 || value > 10_000) {
    throw new RangeError(`${name} must be an integer from 1 to 10,000`);
  }
  return value;
}

function freezeValue(value: unknown): void {
  if (value === null || typeof value !== "object") return;
  for (const child of Object.values(value)) freezeValue(child);
  Object.freeze(value);
}

/** Called only after the bounded JSON boundary has accepted and frozen the value. */
function canonicalValue(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalValue).join(",")}]`;
  const object = value as Record<string, unknown>;
  return `{${Object.keys(object)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalValue(object[key])}`)
    .join(",")}}`;
}
