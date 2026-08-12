import type { Revision } from "@panefold/model";

import type { ProtocolTraceEntry } from "./types";

export class BoundedProtocolTrace<State extends string = string, Event extends string = string> {
  readonly #entries: ProtocolTraceEntry<State, Event>[] = [];
  readonly #limit: number;
  #sequence = 0;

  public constructor(limit = 512) {
    if (!Number.isSafeInteger(limit) || limit < 0) {
      throw new RangeError("Protocol trace limit must be a non-negative safe integer");
    }
    this.#limit = limit;
  }

  public record(input: {
    readonly protocolId: string;
    readonly state: State;
    readonly event: Event;
    readonly revision: Revision;
    readonly timestamp: number;
  }): ProtocolTraceEntry<State, Event> {
    if (!Number.isFinite(input.timestamp)) {
      throw new RangeError("Protocol trace timestamp must be finite");
    }
    const entry = Object.freeze({ ...input, sequence: this.#sequence });
    this.#sequence += 1;
    if (this.#limit > 0) {
      this.#entries.push(entry);
      if (this.#entries.length > this.#limit) {
        this.#entries.splice(0, this.#entries.length - this.#limit);
      }
    }
    return entry;
  }

  public snapshot(): readonly ProtocolTraceEntry<State, Event>[] {
    return Object.freeze([...this.#entries]);
  }

  public clear(): void {
    this.#entries.length = 0;
  }
}
