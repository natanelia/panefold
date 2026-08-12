import { validateBoundaryValue, type BoundaryLimits } from "./boundary";

const IDENTIFIER = /^[A-Za-z0-9._:-]+$/u;
const REVISION = /^(0|[1-9][0-9]*)$/u;

export interface CoordinatorPacketBase {
  readonly protocolVersion: number;
  readonly workspaceId: string;
  readonly sessionNonce: string;
  readonly senderSurfaceId: string;
  readonly coordinatorEpoch: number;
}

export interface DurableTransactionPacket<TWireCommand = unknown> extends CoordinatorPacketBase {
  readonly channel: "transaction";
  readonly transactionId: string;
  readonly actorId: string;
  readonly baseRevision: string;
  readonly command: TWireCommand;
}

export interface PresencePacket<TPresence = unknown> extends CoordinatorPacketBase {
  readonly channel: "presence";
  readonly sequence: number;
  readonly payload: TPresence;
}

export type CoordinatorPacket<TWireCommand = unknown, TPresence = unknown> =
  DurableTransactionPacket<TWireCommand> | PresencePacket<TPresence>;

export interface CoordinatorApplyContext {
  readonly actorId: string;
  readonly senderSurfaceId: string;
  readonly transactionId: string;
  readonly baseRevision: string;
  readonly assignedRevision: string;
  readonly coordinatorEpoch: number;
}

export type CoordinatorApplyResult<TResult> =
  | { readonly accepted: true; readonly result: TResult }
  | { readonly accepted: false; readonly reason: string; readonly result?: TResult };

export interface SingleWriterCoordinatorOptions<TWireCommand, TCommand, TResult, TPresence> {
  readonly protocolVersion: number;
  readonly workspaceId: string;
  readonly sessionNonce: string;
  readonly initialEpoch?: number;
  readonly initialRevision?: string;
  readonly maxReceipts?: number;
  readonly maxPresenceSenders?: number;
  readonly boundaryLimits?: Partial<BoundaryLimits>;
  readonly authorizeSurface?: (surfaceId: string) => boolean;
  readonly decodeCommand: (wireCommand: TWireCommand) => TCommand | undefined;
  readonly apply: (
    command: TCommand,
    context: CoordinatorApplyContext,
  ) => CoordinatorApplyResult<TResult>;
  readonly decodePresence?: (payload: unknown) => TPresence | undefined;
}

export type CoordinatorReceiveResult<TResult> =
  | {
      readonly status: "applied";
      readonly revision: string;
      readonly result: TResult;
    }
  | {
      readonly status: "rejected";
      readonly code:
        | "INVALID_PACKET"
        | "AUTHENTICATION_FAILED"
        | "STALE_EPOCH"
        | "FUTURE_EPOCH"
        | "REVISION_CONFLICT"
        | "COMMAND_REJECTED"
        | "APPLY_FAILED"
        | "CAPACITY_EXCEEDED";
      readonly reason: string;
      readonly result?: TResult;
    }
  | { readonly status: "duplicate"; readonly revision?: string }
  | { readonly status: "presence"; readonly sequence: number }
  | { readonly status: "ignored"; readonly reason: string };

export interface CoordinatorSnapshot<TPresence> {
  readonly workspaceId: string;
  readonly coordinatorEpoch: number;
  readonly revision: string;
  readonly durableReceipts: number;
  readonly presence: Readonly<
    Record<string, { readonly sequence: number; readonly payload: TPresence }>
  >;
}

export interface SingleWriterCoordinator<TWireCommand, TResult, TPresence> {
  readonly receive: (
    packet: CoordinatorPacket<TWireCommand, unknown>,
  ) => CoordinatorReceiveResult<TResult>;
  readonly advanceEpoch: (nextEpoch: number) => void;
  readonly snapshot: () => CoordinatorSnapshot<TPresence>;
}

interface DurableReceipt<TResult> {
  readonly revision?: string;
  readonly result?: TResult;
}

/**
 * Deterministic single-writer intake. It accepts only the active session and
 * epoch, assigns one revision per accepted semantic transaction, bounds its
 * idempotency ledger, and keeps lossy presence outside durable history.
 */
export function createSingleWriterCoordinator<TWireCommand, TCommand, TResult, TPresence = unknown>(
  options: SingleWriterCoordinatorOptions<TWireCommand, TCommand, TResult, TPresence>,
): SingleWriterCoordinator<TWireCommand, TResult, TPresence> {
  validateProtocolOptions(options);
  let epoch = options.initialEpoch ?? 0;
  let revision = parseRevision(options.initialRevision ?? "0");
  const maxReceipts = boundedOption(options.maxReceipts, 4_096, "maxReceipts");
  const maxPresenceSenders = boundedOption(options.maxPresenceSenders, 256, "maxPresenceSenders");
  const receipts = new Map<string, DurableReceipt<TResult>>();
  const presence = new Map<string, { readonly sequence: number; readonly payload: TPresence }>();

  const receive = (
    packet: CoordinatorPacket<TWireCommand, unknown>,
  ): CoordinatorReceiveResult<TResult> => {
    const commonError = validateCommonPacket(packet, options);
    if (commonError !== undefined) return commonError;
    if (packet.coordinatorEpoch < epoch) {
      return rejected("STALE_EPOCH", "Packet belongs to a stale coordinator epoch");
    }
    if (packet.coordinatorEpoch > epoch) {
      return rejected("FUTURE_EPOCH", "Packet belongs to an unknown future coordinator epoch");
    }

    return packet.channel === "presence" ? receivePresence(packet) : receiveTransaction(packet);
  };

  const receivePresence = (packet: PresencePacket<unknown>): CoordinatorReceiveResult<TResult> => {
    if (!Number.isSafeInteger(packet.sequence) || packet.sequence < 1) {
      return rejected("INVALID_PACKET", "Presence sequence must be a positive safe integer");
    }
    const boundary = validateBoundaryValue(packet.payload, options.boundaryLimits);
    if (!boundary.ok) {
      return rejected("INVALID_PACKET", `Presence ${boundary.path}: ${boundary.reason}`);
    }
    const previous = presence.get(packet.senderSurfaceId);
    if (previous !== undefined && packet.sequence <= previous.sequence) {
      return { status: "ignored", reason: "Presence packet is stale or duplicated" };
    }
    if (previous === undefined && presence.size >= maxPresenceSenders) {
      return rejected("CAPACITY_EXCEEDED", "Presence sender capacity reached");
    }
    const decoded = options.decodePresence?.(packet.payload) ?? (packet.payload as TPresence);
    if (decoded === undefined) {
      return rejected("INVALID_PACKET", "Presence payload failed schema validation");
    }
    presence.set(
      packet.senderSurfaceId,
      Object.freeze({ sequence: packet.sequence, payload: decoded }),
    );
    return { status: "presence", sequence: packet.sequence };
  };

  const receiveTransaction = (
    packet: DurableTransactionPacket<TWireCommand>,
  ): CoordinatorReceiveResult<TResult> => {
    const packetError = validateTransactionPacket(packet, options.boundaryLimits);
    if (packetError !== undefined) return rejected("INVALID_PACKET", packetError);
    const duplicate = receipts.get(packet.transactionId);
    if (duplicate !== undefined) {
      return duplicate.revision === undefined
        ? { status: "duplicate" }
        : { status: "duplicate", revision: duplicate.revision };
    }
    const packetRevision = parseRevision(packet.baseRevision);
    if (packetRevision !== revision) {
      return rejected(
        "REVISION_CONFLICT",
        `Expected base revision ${revision.toString()} but received ${packet.baseRevision}`,
      );
    }

    let command: TCommand | undefined;
    try {
      command = options.decodeCommand(packet.command);
    } catch (error) {
      return rejected(
        "INVALID_PACKET",
        error instanceof Error ? error.message : "Command decoder failed",
      );
    }
    if (command === undefined)
      return rejected("INVALID_PACKET", "Command failed schema validation");

    // Reserve the transaction before application code executes. A callback
    // that throws after a side effect cannot cause the packet to be replayed.
    remember(receipts, packet.transactionId, Object.freeze({}), maxReceipts);
    const assignedRevision = (revision + 1n).toString();
    try {
      const applied = options.apply(
        command,
        Object.freeze({
          actorId: packet.actorId,
          senderSurfaceId: packet.senderSurfaceId,
          transactionId: packet.transactionId,
          baseRevision: packet.baseRevision,
          assignedRevision,
          coordinatorEpoch: epoch,
        }),
      );
      if (!applied.accepted) {
        const receipt: DurableReceipt<TResult> =
          applied.result === undefined ? {} : { result: applied.result };
        receipts.set(packet.transactionId, Object.freeze(receipt));
        return {
          status: "rejected",
          code: "COMMAND_REJECTED",
          reason: applied.reason,
          ...(applied.result === undefined ? {} : { result: applied.result }),
        };
      }
      revision += 1n;
      receipts.set(
        packet.transactionId,
        Object.freeze({ revision: revision.toString(), result: applied.result }),
      );
      return { status: "applied", revision: revision.toString(), result: applied.result };
    } catch (error) {
      return rejected(
        "APPLY_FAILED",
        error instanceof Error ? error.message : "Transaction application failed",
      );
    }
  };

  return Object.freeze({
    receive,
    advanceEpoch: (nextEpoch: number) => {
      if (!Number.isSafeInteger(nextEpoch) || nextEpoch <= epoch) {
        throw new RangeError("The next coordinator epoch must be a strictly greater safe integer");
      }
      epoch = nextEpoch;
      presence.clear();
    },
    snapshot: () => {
      const presenceSnapshot = Object.create(null) as Record<
        string,
        { readonly sequence: number; readonly payload: TPresence }
      >;
      for (const [sender, value] of [...presence].sort(([left], [right]) => compare(left, right))) {
        presenceSnapshot[sender] = value;
      }
      return Object.freeze({
        workspaceId: options.workspaceId,
        coordinatorEpoch: epoch,
        revision: revision.toString(),
        durableReceipts: receipts.size,
        presence: Object.freeze(presenceSnapshot),
      });
    },
  });
}

function validateProtocolOptions<TWireCommand, TCommand, TResult, TPresence>(
  options: SingleWriterCoordinatorOptions<TWireCommand, TCommand, TResult, TPresence>,
): void {
  if (!Number.isSafeInteger(options.protocolVersion) || options.protocolVersion < 1) {
    throw new RangeError("protocolVersion must be a positive safe integer");
  }
  validateIdentifier(options.workspaceId, "workspaceId");
  if (options.sessionNonce.length < 16 || options.sessionNonce.length > 512) {
    throw new RangeError("sessionNonce must contain 16 to 512 characters");
  }
  const epoch = options.initialEpoch ?? 0;
  if (!Number.isSafeInteger(epoch) || epoch < 0) {
    throw new RangeError("initialEpoch must be a non-negative safe integer");
  }
  parseRevision(options.initialRevision ?? "0");
}

function validateCommonPacket<TWireCommand, TCommand, TResult, TPresence>(
  packet: CoordinatorPacket<TWireCommand, unknown>,
  options: SingleWriterCoordinatorOptions<TWireCommand, TCommand, TResult, TPresence>,
): CoordinatorReceiveResult<TResult> | undefined {
  if (packet.protocolVersion !== options.protocolVersion) {
    return rejected("INVALID_PACKET", "Unsupported protocol version");
  }
  if (packet.workspaceId !== options.workspaceId) {
    return { status: "ignored", reason: "Packet belongs to another workspace" };
  }
  if (packet.sessionNonce !== options.sessionNonce) {
    return rejected("AUTHENTICATION_FAILED", "Packet is not authenticated to this session");
  }
  if (!validIdentifier(packet.senderSurfaceId)) {
    return rejected("INVALID_PACKET", "Invalid sender surface id");
  }
  if (options.authorizeSurface?.(packet.senderSurfaceId) === false) {
    return rejected("AUTHENTICATION_FAILED", "Sender surface is not authorized");
  }
  if (!Number.isSafeInteger(packet.coordinatorEpoch) || packet.coordinatorEpoch < 0) {
    return rejected("INVALID_PACKET", "Coordinator epoch must be a non-negative safe integer");
  }
  return undefined;
}

function validateTransactionPacket(
  packet: DurableTransactionPacket<unknown>,
  limits: Partial<BoundaryLimits> | undefined,
): string | undefined {
  if (!validIdentifier(packet.transactionId)) return "Invalid transaction id";
  if (!validIdentifier(packet.actorId)) return "Invalid actor id";
  if (!REVISION.test(packet.baseRevision)) return "Base revision must be an unsigned decimal";
  const boundary = validateBoundaryValue(packet.command, limits);
  return boundary.ok ? undefined : `Command ${boundary.path}: ${boundary.reason}`;
}

function validIdentifier(value: string): boolean {
  return value.length > 0 && value.length <= 128 && IDENTIFIER.test(value);
}

function validateIdentifier(value: string, name: string): void {
  if (!validIdentifier(value)) throw new TypeError(`${name} must be a bounded protocol identifier`);
}

function parseRevision(value: string): bigint {
  if (!REVISION.test(value)) throw new TypeError("Revision must be an unsigned decimal string");
  return BigInt(value);
}

function boundedOption(value: number | undefined, fallback: number, name: string): number {
  const resolved = value ?? fallback;
  if (!Number.isSafeInteger(resolved) || resolved < 1 || resolved > 1_000_000) {
    throw new RangeError(`${name} must be an integer from 1 to 1,000,000`);
  }
  return resolved;
}

function remember<TResult>(
  receipts: Map<string, DurableReceipt<TResult>>,
  transactionId: string,
  receipt: DurableReceipt<TResult>,
  limit: number,
): void {
  receipts.set(transactionId, receipt);
  while (receipts.size > limit) {
    const first = receipts.keys().next().value as string | undefined;
    if (first === undefined) break;
    receipts.delete(first);
  }
}

function rejected<TResult>(
  code: Extract<CoordinatorReceiveResult<TResult>, { status: "rejected" }>["code"],
  reason: string,
): CoordinatorReceiveResult<TResult> {
  return { status: "rejected", code, reason };
}

function compare(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}
