// @vitest-environment jsdom
import { StrictMode } from "react";
import { renderToString } from "react-dom/server";
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, test } from "vitest";
import {
  createPanelContextHub,
  type PanelContextConnection,
} from "../../ecosystem/src/panel-context";
import { usePanelContext } from "../src/panel-context";

interface Channels {
  readonly selection: string;
}
const createHub = () =>
  createPanelContextHub<Channels>({
    channels: { selection: (value): value is string => typeof value === "string" },
  });
function Reader({ connection }: { readonly connection: PanelContextConnection<Channels> }) {
  const snapshot = usePanelContext(connection);
  return (
    <output aria-label="Selected entity">{snapshot.contexts.selection?.value ?? "None"}</output>
  );
}
afterEach(cleanup);

test("updates React and catches up after unlocking", () => {
  const hub = createHub();
  const map = hub.connect({ panelId: "map", groupId: "A" });
  const inspector = hub.connect({ panelId: "inspector", groupId: "A" });
  render(<Reader connection={inspector} />);
  act(() => {
    map.publish("selection", "road-1");
  });
  expect(screen.getByLabelText("Selected entity").textContent).toBe("road-1");
  act(() => {
    inspector.setMode("locked");
    map.publish("selection", "road-2");
  });
  expect(screen.getByLabelText("Selected entity").textContent).toBe("road-1");
  act(() => {
    inspector.setMode("follow");
  });
  expect(screen.getByLabelText("Selected entity").textContent).toBe("road-2");
});

test("StrictMode and source changes release subscriptions but not memberships", () => {
  const hub = createHub();
  const a = hub.connect({ panelId: "a", groupId: "A" });
  const b = hub.connect({ panelId: "b", groupId: "B" });
  const view = render(
    <StrictMode>
      <Reader connection={a} />
    </StrictMode>,
  );
  expect(hub.getStats().subscribers).toBe(1);
  view.rerender(
    <StrictMode>
      <Reader connection={b} />
    </StrictMode>,
  );
  expect(hub.getStats().subscribers).toBe(1);
  act(() => {
    a.publish("selection", "not-visible");
  });
  expect(screen.getByLabelText("Selected entity").textContent).toBe("None");
  act(() => {
    b.publish("selection", "visible");
  });
  expect(screen.getByLabelText("Selected entity").textContent).toBe("visible");
  view.unmount();
  expect(hub.getStats()).toEqual({ groups: 2, panels: 2, subscribers: 0 });
  hub.dispose();
  expect(hub.getStats()).toEqual({ groups: 0, panels: 0, subscribers: 0 });
});

test("server rendering uses the request-local snapshot without subscribing", () => {
  const hub = createHub();
  const connection = hub.connect({ panelId: "a", groupId: "A" });
  connection.publish("selection", "road-3");
  expect(renderToString(<Reader connection={connection} />)).toContain("road-3");
  expect(hub.getStats().subscribers).toBe(0);
});

test("an explicit server snapshot can differ from the live source", () => {
  const source = { getSnapshot: () => "live", subscribe: () => () => {} };
  function ServerReader() {
    return <output>{usePanelContext(source, () => "initial")}</output>;
  }
  expect(renderToString(<ServerReader />)).toBe("<output>initial</output>");
});
