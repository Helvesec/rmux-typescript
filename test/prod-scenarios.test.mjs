import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import {
  ControlExit,
  ControlMalformed,
  PaneOutputStream,
  RMUX,
  Rmux,
  RmuxCommandError,
  TextMatch,
} from "../dist/index.js";
import { parseControlLine } from "../dist/control.js";

test("control parser keeps EOF and notification edge cases deterministic", () => {
  assert.equal(parseControlLine("plain text"), undefined);
  assert.deepEqual(parseControlLine("%exit done"), new ControlExit("done"));
  assert.equal(parseControlLine("%output").prefix, "%output");
  const malformed = parseControlLine("%extended-output %1 nope payload");
  assert.ok(malformed instanceof ControlMalformed);
  assert.equal(malformed.reason, "invalid age");
});

test("constructor rejects ambiguous endpoint selection", () => {
  assert.throws(
    () => new RMUX({ socketPath: "/tmp/rmux.sock", socketName: "demo" }),
    /choose only one/,
  );
});

test("command errors preserve stderr and status against real rmux", { timeout: 10_000 }, async (t) => {
  const fixture = await realFixture(t, "errors");
  if (fixture === undefined) {
    return;
  }
  const { rmux, cleanup } = fixture;

  try {
    await rmux.startServer();
    await assert.rejects(
      () => rmux.cmd("definitely-not-a-command", { check: true }),
      (error) => {
        assert.ok(error instanceof RmuxCommandError);
        assert.notEqual(error.run.returnCode, 0);
        assert.match(error.run.stderr, /unknown command|not found|invalid|too long/i);
        assert.match(error.message, /rmux command "definitely-not-a-command" failed/);
        return true;
      },
    );
  } finally {
    await cleanup();
  }
});

test("real endpoint isolation keeps sessions separate", { timeout: 15_000 }, async (t) => {
  const binary = realRmuxBinary();
  if (binary === undefined) {
    t.skip("real rmux binary not available");
    return;
  }

  const root = await mkdtemp(join(tmpdir(), "rmux-ts-prod-isolation-"));
  const first = new Rmux({
    binary,
    socketPath: join(root, "first.sock"),
    checkCompatibility: true,
  });
  const second = new Rmux({
    binary,
    socketPath: join(root, "second.sock"),
    checkCompatibility: true,
  });

  await first.cmd("kill-server");
  await second.cmd("kill-server");
  try {
    await first.startServer();
    await second.startServer();
    assert.equal((await first.capabilities()).binary_contract_version, 1);

    await first.ensureSession("only_first", { shellCommand: "cat" });
    await second.ensureSession("only_second", { shellCommand: "cat" });

    assert.deepEqual(
      (await first.listSessions()).map((session) => session.session_name),
      ["only_first"],
    );
    assert.deepEqual(
      (await second.listSessions()).map((session) => session.session_name),
      ["only_second"],
    );
  } finally {
    await first.cmd("kill-server");
    await second.cmd("kill-server");
    await rm(root, { recursive: true, force: true });
  }
});

test("real lifecycle covers session window pane mutation and lookup", { timeout: 20_000 }, async (t) => {
  const fixture = await realFixture(t, "lifecycle");
  if (fixture === undefined) {
    return;
  }
  const { rmux, cleanup } = fixture;

  try {
    const session = await rmux.ensureSession("ts_lifecycle", { shellCommand: "cat" });
    const renamed = await session.rename("ts_lifecycle_renamed");
    const window = renamed.window(0);

    await window.rename("main");
    const split = await window.pane(0).split({ direction: "horizontal", shellCommand: "cat" });
    await split.select();
    await split.resize({ width: 20 });
    await split.sendText("mutate-ts-sdk\n");
    await split.expectVisibleText().toContain("mutate-ts-sdk").timeout(3);
    await window.selectLayout("even-horizontal");

    const extra = await renamed.newWindow({ name: "extra", shellCommand: "cat" });
    await extra.rename("logs");

    const windows = await renamed.listWindows();
    const panes = await window.listPanes();
    const paneId = await split.id();

    assert.ok(windows.some((entry) => entry.window_name === "main"));
    assert.ok(windows.some((entry) => entry.window_name === "logs"));
    assert.ok(panes.length >= 2);
    assert.match(paneId ?? "", /^%[0-9]+$/);
  } finally {
    await cleanup();
  }
});

test("real text expectations cover exact, nth, last, count and pane-set any", { timeout: 15_000 }, async (t) => {
  const fixture = await realFixture(t, "text");
  if (fixture === undefined) {
    return;
  }
  const { rmux, cleanup } = fixture;

  try {
    const session = await rmux.ensureSession("ts_text", { shellCommand: "cat" });
    const left = session.pane(0, 0);
    const right = await left.split({ direction: "horizontal", shellCommand: "cat" });

    await left.sendText("alpha-one\nalpha-two\n");
    await right.sendText("right-only\n");

    assert.ok((await left.waitForText("alpha-one")) instanceof TextMatch);
    assert.equal((await left.getByText("alpha").expect().toHaveCount(4).timeout(3)), 4);
    assert.equal((await left.getByText("alpha").nth(1).expect().toBeVisible().timeout(3)).text, "alpha");
    assert.equal(
      (await left.getByText("two").last().expect().toHaveText("two").timeout(3)).text,
      "two",
    );

    const rightOnly = await rmux.paneSet([left, right]).expectAny().visibleTextContains("right-only").timeout(3);
    assert.equal(rightOnly.matched.length, 1);
  } finally {
    await cleanup();
  }
});

test("real line and render streams produce useful events", { timeout: 20_000 }, async (t) => {
  const fixture = await realFixture(t, "streams");
  if (fixture === undefined) {
    return;
  }
  const { rmux, cleanup } = fixture;

  try {
    const session = await rmux.ensureSession("ts streams", { shellCommand: "cat" });
    const pane = session.pane(0, 0);
    const split = await pane.split({ direction: "horizontal", shellCommand: "cat" });

    assert.equal(await split.id(), split.target);

    const lines = await pane.lineStream();
    try {
      await pane.sendText("line stream value\n");
      assert.equal(await lines.next(3), "line stream value");
    } finally {
      await lines.close();
    }

    await pane.select();
    const activeBeforeStream = await activePaneId(rmux, "ts streams:0");
    const splitLines = await split.lineStream();
    try {
      assert.equal(await activePaneId(rmux, "ts streams:0"), activeBeforeStream);
      await split.sendText("split stream value\n");
      assert.equal(await splitLines.next(3), "split stream value");
    } finally {
      await splitLines.close();
    }

    const renders = await pane.renderStream();
    try {
      await pane.sendText("render stream value\n");
      const snapshot = await renders.next(3);
      assert.match(snapshot.visibleText, /render stream value/);
    } finally {
      await renders.close();
    }
  } finally {
    await cleanup();
  }
});

async function activePaneId(rmux, target) {
  const panes = await rmux.listPanes({ target });
  return panes.find((pane) => pane.pane_active)?.pane_id;
}

test("real waitForExit reports dead pane status", { timeout: 15_000 }, async (t) => {
  const fixture = await realFixture(t, "exit");
  if (fixture === undefined) {
    return;
  }
  const { rmux, cleanup } = fixture;

  try {
    const session = await rmux.ensureSession("ts_exit", {
      shellCommand: 'sh -c "exit 7"',
    });
    const state = await session.pane(0, 0).waitForExit({ timeout: 3 });
    assert.equal(state.dead, true);
    assert.equal(state.status, 7);
  } finally {
    await cleanup();
  }
});

test("trace maxEvents bounds retained events", { timeout: 10_000 }, async (t) => {
  const fixture = await realFixture(t, "trace");
  if (fixture === undefined) {
    return;
  }
  const { rmux, root, cleanup } = fixture;

  try {
    const session = await rmux.ensureSession("ts_trace", { shellCommand: "cat" });
    const trace = rmux.tracing().maxEvents(2).start();
    trace.recordAction("first");
    trace.recordAction("second");
    await trace.recordSnapshot(session.pane(0, 0));
    const tracePath = await trace.stop(join(root, "trace"));
    const kinds = (await readFile(tracePath, "utf8"))
      .trim()
      .split("\n")
      .map((line) => {
        const event = JSON.parse(line);
        assert.equal(typeof event.timestamp_ms, "number");
        assert.equal("timestampMs" in event, false);
        return event.kind;
      });
    assert.deepEqual(kinds, ["snapshot", "trace.stop"]);
  } finally {
    await cleanup();
  }
});

async function realFixture(t, label) {
  const binary = realRmuxBinary();
  if (binary === undefined) {
    t.skip("real rmux binary not available");
    return undefined;
  }

  const root = await mkdtemp(join(tmpdir(), `rmux-ts-prod-${label}-`));
  const rmux = new Rmux({
    binary,
    socketPath: join(root, "rmux.sock"),
    checkCompatibility: false,
  });
  await rmux.cmd("kill-server");

  return {
    root,
    rmux,
    async cleanup() {
      await rmux.cmd("kill-server");
      await rm(root, { recursive: true, force: true });
    },
  };
}

function realRmuxBinary() {
  if (process.env.RMUX_TEST_BINARY !== undefined && existsSync(process.env.RMUX_TEST_BINARY)) {
    return process.env.RMUX_TEST_BINARY;
  }

  const testDir = dirname(fileURLToPath(import.meta.url));
  const candidate = resolve(testDir, "../../rmux/target/debug/rmux");
  return existsSync(candidate) ? candidate : undefined;
}
