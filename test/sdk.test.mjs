import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { chmodSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import test from "node:test";

import {
  ControlExtendedOutput,
  ControlMalformed,
  ControlModeClient,
  ControlOutput,
  ControlModeStreamEndedError,
  Pane,
  PaneSet,
  RMUX,
  Rmux,
  RmuxCommandError,
  RmuxCompatibilityError,
  Server,
  version,
} from "../dist/index.js";
import { decodeTmuxOctal, parseControlLine } from "../dist/control.js";

test("legacy aliases point to the canonical client", () => {
  assert.equal(RMUX, Rmux);
  assert.equal(Server, Rmux);
  assert.equal(version, "0.6.5");
});

test("exported version matches package metadata", async () => {
  const packageJson = JSON.parse(await readFile(resolve("package.json"), "utf8"));
  assert.equal(version, packageJson.version);
});

test("builder creates a configured client and starts the server", async () => {
  const fake = await fakeRmux();
  try {
    const rmux = await Rmux.builder()
      .binary(fake.path)
      .socketName("demo")
      .checkCompatibility(false)
      .connectOrStart();

    const run = await rmux.cmd("list-panes");
    assert.deepEqual(run.stdout.split(/\n/).slice(0, 2), ["-L", "demo"]);
  } finally {
    await fake.cleanup();
  }
});

test("cmd injects socket path and preserves exit status", async () => {
  const fake = await fakeRmux();
  try {
    const server = new Server({ binary: fake.path, socketPath: "/tmp/rmux.sock" });
    const run = await server.cmd("list-sessions", "--json");

    assert.equal(run.returnCode, 3);
    assert.equal(run.returncode, 3);
    assert.equal(run.stderr, "fake stderr\n");
    assert.deepEqual(run.stdout.split(/\n/).filter(Boolean), [
      "-S",
      "/tmp/rmux.sock",
      "list-sessions",
      "--json",
    ]);
  } finally {
    await fake.cleanup();
  }
});

test("cmd treats an empty trailing options object as options", async () => {
  const fake = await fakeRmux();
  try {
    const server = new Server({ binary: fake.path, checkCompatibility: false });
    const run = await server.cmd("list-sessions", {});

    assert.deepEqual(run.stdout.split(/\n/).filter(Boolean), ["list-sessions"]);
  } finally {
    await fake.cleanup();
  }
});

test("cmd rejects unknown trailing options", async () => {
  const fake = await fakeRmux();
  try {
    const server = new Server({ binary: fake.path, checkCompatibility: false });
    await assert.rejects(
      () => server.cmd("list-sessions", { timeout: 1 }),
      /unknown rmux command option: timeout/,
    );
  } finally {
    await fake.cleanup();
  }
});

test("checked command raises with the run attached", async () => {
  const fake = await fakeRmux();
  try {
    const server = new Server({ binary: fake.path });
    await assert.rejects(
      () => server.cmd("list-sessions", { check: true }),
      (error) =>
        error instanceof RmuxCommandError &&
        error.run.returnCode === 3 &&
        /rmux command "list-sessions" failed with status 3: fake stderr/.test(error.message),
    );
  } finally {
    await fake.cleanup();
  }
});

test("custom env is merged with the process environment", async () => {
  const fake = await fakeRmuxEnv();
  try {
    const server = new Server({ binary: fake.path, env: { FOO: "bar" } });
    const run = await server.cmd("env-check");

    assert.match(run.stdout, /FOO=bar\n/);
    assert.match(run.stdout, /PATH=.+/);
  } finally {
    await fake.cleanup();
  }
});

test("json methods parse objects and arrays", async () => {
  const fake = await fakeRmuxJson({
    ["capabilities\0--json"]: {
      binary_contract_version: 1,
      json_commands: [
        "capabilities",
        "display-message",
        "list-clients",
        "list-panes",
        "list-sessions",
        "list-windows",
      ],
      public_contract: ["control-mode"],
    },
    ["list-sessions\0--json"]: [{ session_name: "demo" }],
    ["list-windows\0-a\0--json"]: [{ window_index: 0 }],
    ["list-panes\0-t\0demo:0\0--json"]: [{ pane_id: "%1" }],
    ["list-clients\0--json"]: [],
  });
  try {
    const server = new Server({ binary: fake.path });

    assert.equal((await server.capabilities()).binary_contract_version, 1);
    assert.equal((await server.listSessions())[0].session_name, "demo");
    assert.equal((await server.listWindows({ allSessions: true }))[0].window_index, 0);
    assert.equal((await server.listPanes({ target: "demo:0" }))[0].pane_id, "%1");
    assert.deepEqual(await server.listClients(), []);
  } finally {
    await fake.cleanup();
  }
});

test("invalid JSON includes command context", async () => {
  const fake = await fakeRmuxJson({
    ["capabilities\0--json"]: "not json",
  });
  try {
    const server = new Server({ binary: fake.path });
    await assert.rejects(
      () => server.capabilities(),
      /rmux returned invalid JSON for capabilities --json/,
    );
  } finally {
    await fake.cleanup();
  }
});

test("rejects incompatible binary contract", async () => {
  const fake = await fakeRmuxJson({
    ["capabilities\0--json"]: {
      binary_contract_version: 2,
      json_commands: ["list-sessions"],
    },
  });
  try {
    const server = new Server({ binary: fake.path });
    await assert.rejects(() => server.listSessions(), RmuxCompatibilityError);
  } finally {
    await fake.cleanup();
  }
});

test("convenience methods honor compatibility checks", async () => {
  const fake = await fakeRmuxJson({
    ["capabilities\0--json"]: {
      binary_contract_version: 2,
      json_commands: ["capabilities"],
    },
  });
  try {
    const server = new Server({ binary: fake.path });

    await assert.rejects(
      () => server.ensureSession("demo"),
      RmuxCompatibilityError,
    );
    await assert.rejects(
      () => server.sendText("%1", "hello"),
      RmuxCompatibilityError,
    );
    await assert.rejects(
      () => server.capturePane({ target: "%1" }),
      RmuxCompatibilityError,
    );
  } finally {
    await fake.cleanup();
  }
});

test("object model uses CLI targets", async () => {
  const fake = await fakeRmuxJson({
    ["capabilities\0--json"]: {
      binary_contract_version: 1,
      json_commands: [
        "capabilities",
        "display-message",
        "list-clients",
        "list-panes",
        "list-sessions",
        "list-windows",
      ],
      public_contract: ["control-mode"],
    },
    ["list-sessions\0--json"]: [{ session_name: "demo", session_id: "$0" }],
    ["list-windows\0-t\0$0\0--json"]: [{ window_index: 0 }],
    ["list-panes\0-t\0$0:0\0--json"]: [{ pane_index: 0, pane_id: "%4" }],
    ["display-message\0--json\0-t\0%4\0#{pane_id}"]: { message: "%4" },
  });
  try {
    const server = new Server({ binary: fake.path });
    const session = (await server.sessions())[0];
    const pane = (await (await session.windows())[0].panes())[0];

    assert.equal(session.name, "demo");
    assert.equal(session.target, "$0");
    assert.equal(pane.target, "%4");
    assert.equal((await server.displayMessage("#{pane_id}", { target: pane.target })).message, "%4");
  } finally {
    await fake.cleanup();
  }
});

test("control output parser decodes tmux octal bytes", () => {
  const event = parseControlLine(String.raw`%output %4 hello world\012\134\377`);

  assert.ok(event instanceof ControlOutput);
  assert.equal(event.paneId, "%4");
  assert.deepEqual(event.data, Buffer.from([..."hello world"].map((c) => c.charCodeAt(0)).concat([10, 92, 255])));
  assert.deepEqual(decodeTmuxOctal(String.raw`a\000b`), Buffer.from([97, 0, 98]));
});

test("control parser rejects malformed extended-output age", () => {
  const event = parseControlLine("%extended-output %1 123abc : hello");

  assert.ok(event instanceof ControlMalformed);
  assert.equal(event.prefix, "%extended-output");
  assert.equal(event.reason, "invalid age");
});

test("control mode reports missing binary as a rejected open", async () => {
  const rmux = new Rmux({ binary: "/definitely/missing/rmux", checkCompatibility: false });

  await assert.rejects(() => rmux.control(), /ENOENT/);
});

test("control mode events end cleanly on EOF", async () => {
  const fake = await fakeControlMode();
  try {
    const rmux = new Rmux({ binary: fake.path, checkCompatibility: false });
    const control = await rmux.control();
    const events = [];

    for await (const event of control.events(0.5)) {
      events.push(event);
    }

    assert.deepEqual(events, []);
    await assert.rejects(() => control.readEvent(0.1), ControlModeStreamEndedError);
  } finally {
    await fake.cleanup();
  }
});

test("control close returns promptly after signaled child is already closed", async () => {
  const child = spawn(process.execPath, ["-e", "setInterval(() => undefined, 1000)"], {
    stdio: ["pipe", "pipe", "pipe"],
  });
  const control = new ControlModeClient(child);

  child.kill("SIGTERM");
  await once(child, "close");
  const started = Date.now();
  await control.close();

  assert.ok(Date.now() - started < 500);
});

test("control close force kills a child that ignores graceful termination", async () => {
  const child = spawn(
    process.execPath,
    [
      "-e",
      [
        "process.stdin.resume();",
        "process.on('SIGTERM', () => undefined);",
        "setInterval(() => undefined, 1000);",
      ].join(""),
    ],
    { stdio: ["pipe", "pipe", "pipe"] },
  );
  const control = new ControlModeClient(child);

  await control.close();

  assert.ok(child.exitCode !== null || child.signalCode !== null);
});

test("control mode rejects concurrent readers deterministically", async () => {
  const child = spawn(
    process.execPath,
    ["-e", "process.stdin.resume(); setInterval(() => undefined, 1000);"],
    { stdio: ["pipe", "pipe", "pipe"] },
  );
  const control = new ControlModeClient(child);
  const pending = control.readEvent(0.2).then(
    () => undefined,
    (error) => error,
  );

  await assert.rejects(
    () => control.readEvent(0.1),
    /control-mode already has an active reader: readEvent/,
  );
  assert.match((await pending).message, /timed out waiting for control-mode event/);
  await control.close();
});

test("snapshot and text locator helpers", async () => {
  const fake = await fakeRmuxJson({
    ["capture-pane\0-p\0-t\0%4"]: "alpha Ready\nbeta Ready\n",
  });
  try {
    const rmux = new Rmux({ binary: fake.path, checkCompatibility: false });
    const pane = new Pane(rmux, "%4");

    const snapshot = await pane.snapshot();
    const first = await pane.getByText("Ready").first().expect().toBeVisible().timeout(0.1);
    const last = await pane.locator("Ready").last().expect().toHaveText("Ready").timeout(0.1);
    const count = await pane.getByText("Ready").expect().toHaveCount(2).timeout(0.1);

    assert.equal(snapshot.visibleText, "alpha Ready\nbeta Ready\n");
    assert.deepEqual(snapshot.lines, ["alpha Ready", "beta Ready"]);
    assert.equal(snapshot.rowText(1), "beta Ready");
    assert.equal(snapshot.findAllText("Ready").length, 2);
    assert.deepEqual([first.row, first.column], [0, 6]);
    assert.deepEqual([last.row, last.column], [1, 5]);
    assert.equal(count, 2);
  } finally {
    await fake.cleanup();
  }
});

test("pane waitForExit does not truncate malformed exit status", async () => {
  const fake = await fakeRmuxJson({
    ["display-message\0-p\0-t\0%4\0#{pane_dead}:#{pane_dead_status}"]: "1:7abc\n",
  });
  try {
    const rmux = new Rmux({ binary: fake.path, checkCompatibility: false });
    const pane = new Pane(rmux, "%4");
    const state = await pane.waitForExit({ timeout: 0.1, interval: 0 });

    assert.equal(state.dead, true);
    assert.equal(state.status, undefined);
  } finally {
    await fake.cleanup();
  }
});

test("trace maxEvents validates bounds and writes empty JSONL when zero", async () => {
  const root = await mkdtemp(join(tmpdir(), "rmux-ts-trace-zero-"));
  try {
    assert.throws(() => new Rmux().tracing().maxEvents(-1), RangeError);
    assert.throws(() => new Rmux().tracing().maxEvents(1.5), RangeError);
    assert.throws(
      () => new Rmux().tracing().start().record("bad", { value: Number.NaN }),
      /finite JSON number/,
    );

    const trace = new Rmux().tracing().maxEvents(0).start();
    trace.recordAction("ignored");
    const tracePath = await trace.stop(root);

    assert.equal(await readFile(tracePath, "utf8"), "");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("real rmux pane text helpers", { timeout: 10_000 }, async (t) => {
  const binary = realRmuxBinary();
  if (binary === undefined) {
    t.skip("real rmux binary not available");
    return;
  }

  const root = await mkdtemp(join(tmpdir(), "rmux-ts-sdk-"));
  const socketPath = join(root, "rmux.sock");
  const rmuxClient = new Rmux({ binary, socketPath, checkCompatibility: false });
  await rmuxClient.cmd("kill-server");
  try {
    const session = await rmuxClient.ensureSession("ts_sdk_smoke", { shellCommand: "cat" });
    const pane = session.pane(0, 0);

    await pane.sendText("hello-ts-sdk\n");
    const match = await pane.expectVisibleText().toContain("hello-ts-sdk").timeout(3);
    const located = await pane.getByText("hello-ts-sdk").expect().toBeVisible().timeout(3);
    const snapshot = await pane.snapshot();

    assert.equal(match.text, "hello-ts-sdk");
    assert.equal(located.text, "hello-ts-sdk");
    assert.match(snapshot.visibleText, /hello-ts-sdk/);
  } finally {
    await rmuxClient.cmd("kill-server");
    await rm(root, { recursive: true, force: true });
  }
});

test("real rmux streams, pane set, and tracing", { timeout: 15_000 }, async (t) => {
  const binary = realRmuxBinary();
  if (binary === undefined) {
    t.skip("real rmux binary not available");
    return;
  }

  const root = await mkdtemp(join(tmpdir(), "rmux-ts-sdk-stream-"));
  const socketPath = join(root, "rmux.sock");
  const rmuxClient = new Rmux({ binary, socketPath, checkCompatibility: false });
  await rmuxClient.cmd("kill-server");
  try {
    const session = await rmuxClient.ensureSession("ts_sdk_stream", { shellCommand: "cat" });
    const left = session.pane(0, 0);
    const right = await left.split({ direction: "horizontal", shellCommand: "cat" });
    const panes = new PaneSet([left, right]);

    const output = await left.outputStream();
    try {
      await left.sendText("stream ts sdk\n");
      const chunk = await nextChunkContaining(output, Buffer.from("stream ts sdk"), 3);
      assert.match(chunk.data.toString("utf8"), /stream ts sdk/);
    } finally {
      await output.close();
    }

    await panes.broadcastText("paneset-ts-sdk\n");
    const outcome = await panes.expectAll().visibleTextContains("paneset-ts-sdk").timeout(3);
    assert.equal(outcome.matched.length, 2);

    const trace = rmuxClient.tracing().maxEvents(10).start();
    trace.recordAction("broadcast paneset-ts-sdk");
    await trace.recordSnapshot(left);
    const tracePath = await trace.stop(join(root, "trace"));
    const traceKinds = (await readFile(tracePath, "utf8"))
      .trim()
      .split("\n")
      .map((line) => {
        const event = JSON.parse(line);
        assert.equal(typeof event.timestamp_ms, "number");
        assert.equal("timestampMs" in event, false);
        return event.kind;
      });
    assert.deepEqual(traceKinds, ["trace.start", "action", "snapshot", "trace.stop"]);
  } finally {
    await rmuxClient.cmd("kill-server");
    await rm(root, { recursive: true, force: true });
  }
});

async function nextChunkContaining(output, needle, timeoutSeconds) {
  const deadline = Date.now() + timeoutSeconds * 1000;
  for (;;) {
    const chunk = await output.next(1);
    if (chunk.data.includes(needle)) {
      return chunk;
    }
    if (Date.now() >= deadline) {
      throw new Error(`stream did not include ${needle.toString("utf8")}`);
    }
  }
}

async function fakeRmux() {
  const root = await mkdtemp(join(tmpdir(), "rmux-ts-fake-"));
  const path = await writeNodeExecutable(
    root,
    "rmux-fake",
    [
      "let isStart = false;",
      "for (const arg of process.argv.slice(2)) {",
      "  if (arg === 'start-server') {",
      "    isStart = true;",
      "  }",
      "  console.log(arg);",
      "}",
      "if (isStart) {",
      "  process.exit(0);",
      "}",
      "console.error('fake stderr');",
      "process.exit(3);",
      "",
    ].join("\n"),
  );
  return { path, cleanup: () => rm(root, { recursive: true, force: true }) };
}

async function fakeRmuxEnv() {
  const root = await mkdtemp(join(tmpdir(), "rmux-ts-env-"));
  const path = await writeNodeExecutable(
    root,
    "rmux-env",
    [
      "console.log('PATH=' + (process.env.PATH ?? ''));",
      "console.log('FOO=' + (process.env.FOO ?? ''));",
      "",
    ].join("\n"),
  );
  return { path, cleanup: () => rm(root, { recursive: true, force: true }) };
}

async function fakeControlMode() {
  const root = await mkdtemp(join(tmpdir(), "rmux-ts-control-"));
  const path = await writeNodeExecutable(root, "rmux-control", "process.exit(0);\n");
  return { path, cleanup: () => rm(root, { recursive: true, force: true }) };
}

async function fakeRmuxJson(responses) {
  const root = await mkdtemp(join(tmpdir(), "rmux-ts-json-"));
  const dataPath = join(root, "responses.json");
  await writeFile(dataPath, JSON.stringify(responses), "utf8");
  const path = await writeNodeExecutable(
    root,
    "rmux-json",
    [
      "import { readFileSync } from 'node:fs';",
      `const data = JSON.parse(readFileSync(${JSON.stringify(dataPath)}, 'utf8'));`,
      "const key = process.argv.slice(2).join('\\0');",
      "if (!(key in data)) {",
      "  console.error('missing fake response for ' + JSON.stringify(process.argv.slice(2)));",
      "  process.exit(2);",
      "}",
      "const value = data[key];",
      "if (typeof value === 'string') {",
      "  process.stdout.write(value);",
      "} else {",
      "  process.stdout.write(JSON.stringify(value) + '\\n');",
      "}",
      "",
    ].join("\n"),
  );
  return {
    path,
    async cleanup() {
      await rm(root, { recursive: true, force: true });
    },
  };
}

async function writeNodeExecutable(root, name, source) {
  if (process.platform === "win32") {
    const scriptPath = join(root, `${name}.mjs`);
    const path = join(root, `${name}.cmd`);
    await writeFile(scriptPath, source, "utf8");
    await writeFile(path, `@echo off\r\n"${process.execPath}" "${scriptPath}" %*\r\n`, "utf8");
    return path;
  }

  const path = join(root, name);
  await writeFile(path, `#!/usr/bin/env node\n${source}`, "utf8");
  chmodSync(path, 0o755);
  return path;
}

function realRmuxBinary() {
  if (process.env.RMUX_TEST_BINARY !== undefined && existsSync(process.env.RMUX_TEST_BINARY)) {
    return process.env.RMUX_TEST_BINARY;
  }

  const testDir = dirname(fileURLToPath(import.meta.url));
  const candidate = resolve(testDir, "../../rmux/target/debug/rmux");
  return existsSync(candidate) ? candidate : undefined;
}
