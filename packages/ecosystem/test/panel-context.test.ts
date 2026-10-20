import { strict as assert } from "node:assert";
import { test } from "vitest";
import {
  createPanelContextHub,
  type PanelContextHubOptions,
  type PanelContextPublishResult,
} from "../src/panel-context";

type RoadId = `road-${number}`;
interface Selection {
  readonly entityId: RoadId;
  readonly tags?: readonly string[];
}
interface Channels {
  readonly selection: Selection | null;
  readonly time: number;
}

const channels: PanelContextHubOptions<Channels>["channels"] = {
  selection: (value): value is Selection | null =>
    value === null ||
    (typeof value === "object" &&
      "entityId" in value &&
      typeof value.entityId === "string" &&
      /^road-\d+$/u.test(value.entityId)),
  time: (value): value is number => typeof value === "number" && Number.isFinite(value),
};
const hub = (options: Partial<PanelContextHubOptions<Channels>> = {}) =>
  createPanelContextHub<Channels>({ channels, ...options });
const road = (number: number): Selection => ({ entityId: `road-${number}` });

test("publishes typed context and source to every following panel before notification", () => {
  const source = hub();
  const map = source.connect({ panelId: "map", groupId: "A" });
  const table = source.connect({ panelId: "table", groupId: "A" });
  const inspector = source.connect({ panelId: "inspector", groupId: "A" });
  let observed = 0;
  map.subscribe(() => {
    assert.equal(inspector.getSnapshot().contexts.selection?.value?.entityId, "road-1");
    observed += 1;
  });
  const result = map.publish("selection", road(1));
  assert.equal(result.status, "published");
  assert.equal(observed, 1);
  assert.equal(table.getSnapshot().contexts, inspector.getSnapshot().contexts);
  assert.equal(table.getSnapshot().contexts.selection?.sourcePanelId, "map");
  assert.equal(table.getSnapshot().contexts.selection?.groupId, "A");
  assert.equal(table.getSnapshot().contexts.selection?.sequence, 1);
  assert.equal(table.getSnapshot(), table.getSnapshot());
});

test("isolates named groups and separate hub instances", () => {
  const source = hub();
  const a = source.connect({ panelId: "a", groupId: "A" });
  const b = source.connect({ panelId: "b", groupId: "B" });
  const other = hub().connect({ panelId: "a", groupId: "A" });
  const previous = b.getSnapshot();
  a.publish("selection", road(1));
  assert.equal(b.getSnapshot(), previous);
  assert.equal(other.getSnapshot().contexts.selection, undefined);
});

test("retains the latest value independently for each channel", () => {
  const source = hub();
  const a = source.connect({ panelId: "a", groupId: "A" });
  a.publish("selection", road(1));
  a.publish("time", 42);
  assert.equal(a.getSnapshot().contexts.selection?.value?.entityId, "road-1");
  assert.equal(a.getSnapshot().contexts.time?.value, 42);
});

test("late joins start from the current group context", () => {
  const source = hub();
  source.connect({ panelId: "a", groupId: "A" }).publish("selection", road(2));
  const late = source.connect({ panelId: "late", groupId: "A" });
  assert.equal(late.getSnapshot().contexts.selection?.value?.entityId, "road-2");
});

test("locked panels retain their snapshot and cannot publish", () => {
  const source = hub();
  const a = source.connect({ panelId: "a", groupId: "A" });
  const b = source.connect({ panelId: "b", groupId: "A" });
  a.publish("selection", road(1));
  b.setMode("locked");
  const pinned = b.getSnapshot();
  a.publish("selection", road(2));
  assert.equal(b.getSnapshot(), pinned);
  assert.deepEqual(b.publish("selection", road(3)), { status: "rejected", reason: "locked" });
  b.setMode("follow");
  assert.equal(b.getSnapshot().contexts.selection?.value?.entityId, "road-2");
});

test("a locked late join captures the current context and unlock catches up all channels", () => {
  const source = hub();
  const a = source.connect({ panelId: "a", groupId: "A" });
  a.publish("time", 1);
  const b = source.connect({ panelId: "b", groupId: "A", mode: "locked" });
  a.publish("time", 2);
  a.publish("selection", road(3));
  assert.equal(b.getSnapshot().contexts.time?.value, 1);
  b.setMode("follow");
  assert.equal(b.getSnapshot().contexts.time?.value, 2);
  assert.equal(b.getSnapshot().contexts.selection?.value?.entityId, "road-3");
});

test("group changes adopt destination context even when locked", () => {
  const source = hub();
  const a = source.connect({ panelId: "a", groupId: "A" });
  const b = source.connect({ panelId: "b", groupId: "B" });
  a.publish("selection", road(1));
  b.publish("time", 9);
  a.setMode("locked");
  a.setGroup("B");
  assert.equal(a.getSnapshot().contexts.selection, undefined);
  assert.equal(a.getSnapshot().contexts.time?.value, 9);
  assert.equal(a.getSnapshot().mode, "locked");
  assert.equal(source.getStats().groups, 1);
});

test("same mode and same group preserve snapshot identity and emit nothing", () => {
  const a = hub().connect({ panelId: "a", groupId: "A" });
  const initial = a.getSnapshot();
  let calls = 0;
  a.subscribe(() => calls++);
  a.setGroup("A");
  a.setMode("follow");
  assert.equal(a.getSnapshot(), initial);
  assert.equal(calls, 0);
});

test("unchanged objects are deduplicated even when property order differs", () => {
  const a = hub().connect({ panelId: "a", groupId: "A" });
  a.publish("selection", { entityId: "road-1", tags: ["a"] });
  const snapshot = a.getSnapshot();
  assert.deepEqual(a.publish("selection", { tags: ["a"], entityId: "road-1" }), {
    status: "ignored",
    reason: "unchanged",
  });
  assert.equal(a.getSnapshot(), snapshot);
});

test("null clears selection without clearing other channels", () => {
  const a = hub().connect({ panelId: "a", groupId: "A" });
  a.publish("selection", road(1));
  a.publish("time", 3);
  a.publish("selection", null);
  assert.equal(a.getSnapshot().contexts.selection?.value, null);
  assert.equal(a.getSnapshot().contexts.time?.value, 3);
});

test("owns and deeply freezes payloads without freezing caller data", () => {
  const a = hub().connect({ panelId: "a", groupId: "A" });
  const value: { entityId: RoadId; tags: string[] } = { entityId: "road-1", tags: ["safe"] };
  a.publish("selection", value);
  value.entityId = "road-2";
  value.tags.push("changed");
  const event = a.getSnapshot().contexts.selection;
  assert.equal(event?.value?.entityId, "road-1");
  assert.deepEqual(event?.value?.tags, ["safe"]);
  assert.ok(Object.isFrozen(event));
  assert.ok(Object.isFrozen(event?.value));
  assert.ok(Object.isFrozen(event?.value?.tags));
  assert.ok(Object.isFrozen(a.getSnapshot().contexts));
  assert.ok(!Object.isFrozen(value));
});

test("suppresses async echoes, including events older than the current selection", async () => {
  const source = hub();
  const a = source.connect({ panelId: "a", groupId: "A" });
  const b = source.connect({ panelId: "b", groupId: "A" });
  a.publish("selection", road(1));
  const cause = b.getSnapshot().contexts.selection;
  assert.ok(cause);
  a.publish("selection", road(2));
  await Promise.resolve();
  assert.deepEqual(b.publish("selection", road(1), { cause }), {
    status: "ignored",
    reason: "echo",
  });
  assert.equal(b.getSnapshot().contexts.selection?.value?.entityId, "road-2");
});

test("rejects forged, foreign, cross-channel and old-group causes", () => {
  const source = hub();
  const a = source.connect({ panelId: "a", groupId: "A" });
  a.publish("selection", road(1));
  const cause = a.getSnapshot().contexts.selection;
  assert.ok(cause);
  const invalid = { status: "rejected", reason: "invalid-cause" };
  assert.deepEqual(a.publish("selection", road(1), { cause: { ...cause } }), invalid);
  assert.deepEqual(a.publish("time", 1, { cause }), invalid);
  const foreign = hub().connect({ panelId: "other", groupId: "A" });
  assert.deepEqual(foreign.publish("selection", road(1), { cause }), invalid);
  a.setGroup("B");
  assert.deepEqual(a.publish("selection", road(1), { cause }), invalid);
});

test("blocks synchronous feedback rather than growing a notification queue", () => {
  const a = hub().connect({ panelId: "a", groupId: "A" });
  let nested: PanelContextPublishResult<number> | undefined;
  a.subscribe(() => {
    nested = a.publish("time", 99);
    assert.throws(() => a.setGroup("B"), /notification/u);
  });
  a.publish("time", 1);
  assert.deepEqual(nested, { status: "rejected", reason: "reentrant" });
  assert.equal(a.getSnapshot().contexts.time?.value, 1);
});

test("subscriber and reporting exceptions cannot stop later subscribers", () => {
  const errors: string[] = [];
  const source = hub({
    onSubscriberError: (panelId) => {
      errors.push(panelId);
      throw new Error("reporter failed");
    },
  });
  const a = source.connect({ panelId: "a", groupId: "A" });
  let calls = 0;
  a.subscribe(() => {
    throw new Error("private application error");
  });
  a.subscribe(() => calls++);
  assert.equal(a.publish("time", 1).status, "published");
  assert.equal(calls, 1);
  assert.deepEqual(errors, ["a"]);
});

test("unsubscribe during notification skips the removed subscriber", () => {
  const a = hub().connect({ panelId: "a", groupId: "A" });
  let calls = 0;
  let unsubscribe = () => {};
  a.subscribe(() => unsubscribe());
  unsubscribe = a.subscribe(() => calls++);
  a.publish("time", 1);
  assert.equal(calls, 0);
});

test("bounds subscriber leases, including repeated callbacks, and permits cleanup", () => {
  const source = hub({ maxSubscribersPerPanel: 2 });
  const a = source.connect({ panelId: "a", groupId: "A" });
  let calls = 0;
  const listener = () => calls++;
  const first = a.subscribe(listener);
  const second = a.subscribe(listener);
  assert.throws(() => a.subscribe(listener), /subscriber limit/u);
  first();
  first();
  a.publish("time", 1);
  assert.equal(calls, 1);
  second();
  assert.equal(source.getStats().subscribers, 0);
});

test("bounds panel membership and rejects duplicate panel IDs", () => {
  const source = hub({ maxPanels: 1 });
  const a = source.connect({ panelId: "a", groupId: "A" });
  assert.throws(() => source.connect({ panelId: "a", groupId: "B" }), /only once/u);
  assert.throws(() => source.connect({ panelId: "b", groupId: "A" }), /member limit/u);
  a.dispose();
  source.connect({ panelId: "b", groupId: "A" });
  assert.equal(source.getStats().panels, 1);
});

test("group replacement at capacity works when the source group becomes empty", () => {
  const source = hub({ maxGroups: 1 });
  const a = source.connect({ panelId: "a", groupId: "A" });
  a.publish("time", 1);
  a.setGroup("B");
  assert.equal(a.getSnapshot().groupId, "B");
  assert.equal(a.getSnapshot().contexts.time, undefined);
  assert.equal(source.getStats().groups, 1);
});

test("a failed group switch leaves the original membership unchanged", () => {
  const source = hub({ maxGroups: 1 });
  const a = source.connect({ panelId: "a", groupId: "A" });
  source.connect({ panelId: "b", groupId: "A" });
  const snapshot = a.getSnapshot();
  assert.throws(() => a.setGroup("B"), /group limit/u);
  assert.throws(() => source.connect({ panelId: "c", groupId: "B" }), /group limit/u);
  assert.equal(a.getSnapshot(), snapshot);
  assert.equal(source.getStats().panels, 2);
});

for (const invalid of [undefined, NaN, Infinity, new Date(0), () => {}, { bad: 1 }]) {
  test(`rejects invalid payload ${String(invalid)} without changing state`, () => {
    const a = hub().connect({ panelId: "a", groupId: "A" });
    const before = a.getSnapshot();
    assert.deepEqual(a.publish("selection", invalid as never), {
      status: "rejected",
      reason: "invalid-value",
    });
    assert.equal(a.getSnapshot(), before);
    a.publish("selection", road(1));
    assert.equal(a.getSnapshot().contexts.selection?.sequence, 1);
  });
}

test("rejects cyclic, deep and oversized values", () => {
  const a = hub({
    valueLimits: { maxDepth: 3, maxStringLength: 16, maxArrayLength: 2 },
  }).connect({ panelId: "a", groupId: "A" });
  const cyclic: { entityId: string; self?: unknown } = { entityId: "road-1" };
  cyclic.self = cyclic;
  for (const value of [
    cyclic,
    { entityId: "road-1", nested: { nested: { nested: { n: 1 } } } },
    { entityId: "road-1", tags: ["a", "b", "c"] },
    { entityId: `road-${"1".repeat(30)}` },
  ]) {
    assert.equal(a.publish("selection", value as never).status, "rejected");
  }
  assert.equal(a.getSnapshot().contexts.selection, undefined);
});

test("rejects throwing validators and validators cannot reenter publication", () => {
  let publish: (() => void) | undefined;
  const source = hub({
    channels: {
      ...channels,
      time: (_value): _value is number => {
        publish?.();
        throw new Error("bad validator");
      },
    },
  });
  const a = source.connect({ panelId: "a", groupId: "A" });
  publish = () =>
    assert.deepEqual(a.publish("time", 2), { status: "rejected", reason: "reentrant" });
  assert.deepEqual(a.publish("time", 1), { status: "rejected", reason: "invalid-value" });
  assert.equal(a.getSnapshot().contexts.time, undefined);
});

test("a validator cannot resurrect a disposed connection", () => {
  let dispose = () => {};
  const source = hub({
    channels: {
      ...channels,
      time: (_value): _value is number => {
        dispose();
        return true;
      },
    },
  });
  const a = source.connect({ panelId: "a", groupId: "A" });
  dispose = a.dispose;
  assert.deepEqual(a.publish("time", 1), { status: "rejected", reason: "disposed" });
  assert.deepEqual(source.getStats(), { groups: 0, panels: 0, subscribers: 0 });
});

test("disposal is idempotent and old handles cannot affect a replacement panel", () => {
  const source = hub();
  const old = source.connect({ panelId: "a", groupId: "A" });
  old.subscribe(() => assert.fail("disposed subscriber was called"));
  old.dispose();
  const next = source.connect({ panelId: "a", groupId: "A" });
  old.dispose();
  assert.deepEqual(old.publish("time", 1), { status: "rejected", reason: "disposed" });
  assert.throws(() => old.setMode("locked"), /disposed/u);
  assert.equal(old.getSnapshot().connected, false);
  assert.equal(next.publish("time", 2).status, "published");
  source.dispose();
  source.dispose();
  assert.deepEqual(source.getStats(), { groups: 0, panels: 0, subscribers: 0 });
  assert.throws(() => source.connect({ panelId: "new", groupId: "A" }), /disposed/u);
});

test("disposal during notification stops later callbacks", () => {
  const source = hub();
  const a = source.connect({ panelId: "a", groupId: "A" });
  const b = source.connect({ panelId: "b", groupId: "A" });
  a.subscribe(source.dispose);
  b.subscribe(() => assert.fail("hub was already disposed"));
  assert.equal(a.publish("time", 1).status, "published");
  assert.equal(b.getSnapshot().connected, false);
});

test("one thousand lifecycle cycles leave no retained groups", () => {
  const source = hub();
  for (let index = 0; index < 1_000; index += 1) {
    const a = source.connect({ panelId: "a", groupId: "A" });
    a.subscribe(() => {});
    a.publish("time", index);
    a.setGroup("B");
    a.dispose();
  }
  assert.deepEqual(source.getStats(), { groups: 0, panels: 0, subscribers: 0 });
});

test("rejects bad configuration and identifiers", () => {
  for (const maxPanels of [0, -1, 1.5, NaN, Infinity, 10_001]) {
    assert.throws(() => hub({ maxPanels }), RangeError);
  }
  assert.throws(() => hub({ valueLimits: { maxDepth: 0 } }), RangeError);
  const source = hub();
  for (const panelId of ["", " ", "x".repeat(129)]) {
    assert.throws(() => source.connect({ panelId, groupId: "A" }), TypeError);
  }
  assert.throws(() => source.connect({ panelId: "a", groupId: "" }), TypeError);
  const a = source.connect({ panelId: "a", groupId: "A" });
  assert.throws(() => a.setMode("bad" as never), TypeError);
  assert.throws(() => a.setGroup(""), TypeError);
});

test("public types reject unknown channels and mismatched values", () => {
  const a = hub().connect({ panelId: "a", groupId: "A" });
  // @ts-expect-error Channel names are constrained to the registered schema.
  assert.equal(a.publish("unknown", 1).status, "rejected");
  // @ts-expect-error Time is numeric, not an entity selection.
  assert.equal(a.publish("time", road(1)).status, "rejected");
  // @ts-expect-error Entity IDs use the application type, not arbitrary strings.
  assert.equal(a.publish("selection", { entityId: "other" }).status, "rejected");
});
