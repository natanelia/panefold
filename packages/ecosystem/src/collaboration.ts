export interface RemoteCommandEnvelope<TWireCommand> {
  readonly protocolVersion: 1;
  readonly workspaceId: string;
  readonly senderId: string;
  readonly sequence: number;
  readonly command: TWireCommand;
}

export interface RemoteDispatchOptions {
  readonly origin: "remote";
  readonly label: string;
}

export interface RemoteDispatchTarget<TCommand, TResult> {
  readonly dispatch: (command: TCommand, options: RemoteDispatchOptions) => TResult;
}

export interface RemoteCommandBridgeOptions<TWireCommand, TCommand, TResult> {
  readonly workspaceId: string;
  readonly localSenderId: string;
  readonly maxSenders?: number;
  readonly decodeCommand: (wireCommand: TWireCommand) => TCommand | undefined;
  readonly acceptedResult?: (result: TResult) => boolean;
  readonly commandLabel?: (command: TCommand) => string;
}

export type RemoteReceiveResult<TResult> =
  | { readonly status: "applied"; readonly result: TResult }
  | { readonly status: "rejected"; readonly reason: string; readonly result?: TResult }
  | { readonly status: "duplicate" | "ignored" | "invalid"; readonly reason: string };

export interface RemoteCommandBridge<TWireCommand, TResult> {
  readonly receive: (envelope: RemoteCommandEnvelope<TWireCommand>) => RemoteReceiveResult<TResult>;
  readonly lastSequence: (senderId: string) => number | undefined;
  readonly senderCount: () => number;
}

/**
 * Validated inbound-command boundary only. Transport, authentication,
 * coordinator election, and conflict resolution remain application concerns.
 */
export function createRemoteCommandBridge<TWireCommand, TCommand, TResult>(
  target: RemoteDispatchTarget<TCommand, TResult>,
  options: RemoteCommandBridgeOptions<TWireCommand, TCommand, TResult>,
): RemoteCommandBridge<TWireCommand, TResult> {
  const maxSenders = options.maxSenders ?? 128;
  if (!Number.isSafeInteger(maxSenders) || maxSenders < 1 || maxSenders > 10_000) {
    throw new RangeError("Remote sender limit must be an integer from 1 to 10,000");
  }
  const lastSequences = new Map<string, number>();

  return {
    receive: (envelope) => {
      const metadataError = validateEnvelopeMetadata(envelope);
      if (metadataError !== undefined) {
        return { status: "invalid", reason: metadataError };
      }
      if (envelope.workspaceId !== options.workspaceId) {
        return { status: "ignored", reason: "Envelope belongs to another workspace" };
      }
      if (envelope.senderId === options.localSenderId) {
        return { status: "ignored", reason: "Local command echo" };
      }
      const previousSequence = lastSequences.get(envelope.senderId);
      if (previousSequence !== undefined && envelope.sequence <= previousSequence) {
        return { status: "duplicate", reason: "Sequence was already observed" };
      }
      if (previousSequence === undefined && lastSequences.size >= maxSenders) {
        return { status: "rejected", reason: "Remote sender capacity reached" };
      }

      let command: TCommand | undefined;
      try {
        command = options.decodeCommand(envelope.command);
      } catch (error) {
        return {
          status: "invalid",
          reason: error instanceof Error ? error.message : "Command decoder failed",
        };
      }
      if (command === undefined) {
        return { status: "invalid", reason: "Remote command failed validation" };
      }

      // Mark the envelope before invoking application code so a throwing
      // target cannot cause the same remote side effect to be replayed.
      lastSequences.set(envelope.senderId, envelope.sequence);
      try {
        const result = target.dispatch(command, {
          origin: "remote",
          label: options.commandLabel?.(command) ?? `Remote command from ${envelope.senderId}`,
        });
        if (options.acceptedResult?.(result) === false) {
          return { status: "rejected", reason: "Runtime rejected remote command", result };
        }
        return { status: "applied", result };
      } catch (error) {
        return {
          status: "rejected",
          reason: error instanceof Error ? error.message : "Remote dispatch failed",
        };
      }
    },
    lastSequence: (senderId) => lastSequences.get(senderId),
    senderCount: () => lastSequences.size,
  };
}

function validateEnvelopeMetadata<TWireCommand>(
  envelope: RemoteCommandEnvelope<TWireCommand>,
): string | undefined {
  if (envelope.protocolVersion !== 1) return "Unsupported remote protocol version";
  if (!validIdentifier(envelope.workspaceId)) return "Invalid workspace id";
  if (!validIdentifier(envelope.senderId)) return "Invalid sender id";
  if (!Number.isSafeInteger(envelope.sequence) || envelope.sequence < 1) {
    return "Remote sequence must be a positive safe integer";
  }
  return undefined;
}

function validIdentifier(value: string) {
  return value.length > 0 && value.length <= 128 && /^[A-Za-z0-9._:-]+$/.test(value);
}
