import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import {
  deadlineFromNow,
  remainingMilliseconds,
} from "./duration.js";
import { mergedEnv } from "./process.js";
import type { Duration, Environment } from "./types.js";

export class ControlOutput {
  readonly paneId: string;
  readonly data: Buffer;

  constructor(paneId: string, data: Buffer) {
    this.paneId = paneId;
    this.data = data;
  }

  get pane_id(): string {
    return this.paneId;
  }
}

export class ControlExtendedOutput {
  readonly paneId: string;
  readonly ageMs: number;
  readonly data: Buffer;

  constructor(paneId: string, ageMs: number, data: Buffer) {
    this.paneId = paneId;
    this.ageMs = ageMs;
    this.data = data;
  }

  get pane_id(): string {
    return this.paneId;
  }

  get age_ms(): number {
    return this.ageMs;
  }
}

export class ControlExit {
  readonly reason?: string;

  constructor(reason?: string) {
    if (reason !== undefined) {
      this.reason = reason;
    }
  }
}

export class ControlNotification {
  readonly prefix: string;
  readonly line: string;

  constructor(prefix: string, line: string) {
    this.prefix = prefix;
    this.line = line;
  }
}

export class ControlMalformed {
  readonly prefix: string;
  readonly line: string;
  readonly reason: string;

  constructor(prefix: string, line: string, reason: string) {
    this.prefix = prefix;
    this.line = line;
    this.reason = reason;
  }
}

export class ControlModeStreamEndedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ControlModeStreamEndedError";
  }
}

export type ControlEvent =
  | ControlOutput
  | ControlExtendedOutput
  | ControlExit
  | ControlMalformed
  | ControlNotification;

export interface ControlProcessOptions {
  readonly binary: string;
  readonly args: readonly string[];
  readonly cwd?: string | undefined;
  readonly env?: Environment | undefined;
}

export function spawnControlProcess(options: ControlProcessOptions): ChildProcessWithoutNullStreams {
  const child = spawn(options.binary, options.args, {
    cwd: options.cwd,
    env: mergedEnv(options.env),
    stdio: ["pipe", "pipe", "pipe"],
  });
  return child;
}

export function waitForControlProcessSpawn(
  process: ChildProcessWithoutNullStreams,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const cleanup = (): void => {
      process.off("error", onError);
      process.off("spawn", onSpawn);
    };
    const onError = (error: Error): void => {
      cleanup();
      reject(error);
    };
    const onSpawn = (): void => {
      cleanup();
      resolve();
    };
    process.once("error", onError);
    process.once("spawn", onSpawn);
  });
}

export class ControlModeClient {
  readonly process: ChildProcessWithoutNullStreams;
  readonly #lines = new AsyncQueue<ControlLineQueueItem>();
  readonly #deferredEvents: ControlEvent[] = [];
  #buffer = "";
  #stderr = "";
  #closed = false;
  #ended = false;
  #processError: Error | undefined;
  #activeReader: string | undefined;

  constructor(process: ChildProcessWithoutNullStreams) {
    this.process = process;
    this.process.stdout.setEncoding("utf8");
    this.process.stderr.setEncoding("utf8");
    this.process.stdout.on("data", (chunk: string) => {
      this.feedStdout(chunk);
    });
    this.process.stdout.on("end", () => {
      if (this.#buffer.length > 0) {
        this.#lines.push({ kind: "line", line: this.#buffer });
        this.#buffer = "";
      }
      this.finish();
    });
    this.process.stderr.on("data", (chunk: string) => {
      this.#stderr = (this.#stderr + chunk).slice(-4096);
    });
    this.process.on("error", (error: Error) => {
      this.#processError = error;
      this.finish();
    });
    this.process.on("close", () => {
      this.finish();
    });
  }

  sendCommand(command: string): void {
    if (isChildClosed(this.process)) {
      throw new Error("control-mode process has exited");
    }
    try {
      this.process.stdin.write(command);
      if (!command.endsWith("\n")) {
        this.process.stdin.write("\n");
      }
    } catch (error) {
      throw new Error(`failed to write control-mode command: ${errorMessage(error)}`);
    }
  }

  async runCommand(command: string, timeout: Duration = 5): Promise<void> {
    const releaseReader = this.acquireReader("runCommand");
    const deadline = deadlineFromNow(timeout);
    try {
      this.sendCommand(command);

      let commandKey: string | undefined;
      for (;;) {
        const event = await this.readEventFromLines({
          milliseconds: remainingMilliseconds(deadline),
        });
        if (event instanceof ControlExit) {
          throw new ControlModeStreamEndedError(
            `control-mode exited while running ${command}: ${event.reason ?? "unknown reason"}`,
          );
        }
        if (!(event instanceof ControlNotification)) {
          this.#deferredEvents.push(event);
          continue;
        }
        if (event.prefix === "%begin") {
          commandKey = controlCommandKey(event.line);
          continue;
        }
        if (event.prefix !== "%end" && event.prefix !== "%error") {
          continue;
        }
        const eventKey = controlCommandKey(event.line);
        if (commandKey !== undefined && eventKey !== undefined && eventKey !== commandKey) {
          continue;
        }
        if (event.prefix === "%error") {
          throw new Error(
            `control-mode command failed: ${command}; event=${JSON.stringify(event.line)}`,
          );
        }
        return;
      }
    } finally {
      releaseReader();
    }
  }

  async readEvent(timeout?: Duration): Promise<ControlEvent> {
    const releaseReader = this.acquireReader("readEvent");
    try {
      return await this.readEventUnlocked(timeout);
    } finally {
      releaseReader();
    }
  }

  private async readEventUnlocked(timeout?: Duration): Promise<ControlEvent> {
    const deferred = this.#deferredEvents.shift();
    if (deferred !== undefined) {
      return deferred;
    }
    return this.readEventFromLines(timeout);
  }

  private async readEventFromLines(timeout?: Duration): Promise<ControlEvent> {
    const deadline = timeout === undefined ? undefined : deadlineFromNow(timeout);
    for (;;) {
      if (this.#ended && this.#lines.isEmpty()) {
        throw this.streamEndedError();
      }
      const timeoutMs =
        deadline === undefined ? undefined : remainingMilliseconds(deadline);
      const item = await this.#lines.shift(timeoutMs);
      if (item.kind === "end") {
        throw this.streamEndedError();
      }
      const event = parseControlLine(item.line.replace(/\n$/, ""));
      if (event !== undefined) {
        return event;
      }
    }
  }

  async *events(timeout?: Duration): AsyncGenerator<ControlEvent> {
    const releaseReader = this.acquireReader("events");
    try {
      for (;;) {
        let event: ControlEvent;
        try {
          event = await this.readEventUnlocked(timeout);
        } catch (error) {
          if (error instanceof ControlModeStreamEndedError) {
            return;
          }
          throw error;
        }
        yield event;
        if (event instanceof ControlExit) {
          return;
        }
      }
    } finally {
      releaseReader();
    }
  }

  async waitForExit(timeout?: Duration): Promise<ControlExit> {
    for await (const event of this.events(timeout)) {
      if (event instanceof ControlExit) {
        return event;
      }
    }
    throw new Error("control-mode stream ended before %exit");
  }

  async close(): Promise<void> {
    if (this.#closed) {
      return;
    }
    this.#closed = true;

    if (!isChildClosed(this.process)) {
      try {
        this.process.stdin.write("\n");
        this.process.stdin.end();
      } catch {
        // Best-effort close path.
      }

      try {
        await waitForChildClose(this.process, 2000);
      } catch {
        this.process.kill("SIGKILL");
        await waitForChildClose(this.process, 2000);
      }
    }
  }

  private acquireReader(operation: string): () => void {
    if (this.#activeReader !== undefined) {
      throw new Error(`control-mode already has an active reader: ${this.#activeReader}`);
    }
    this.#activeReader = operation;
    return () => {
      if (this.#activeReader === operation) {
        this.#activeReader = undefined;
      }
    };
  }

  private feedStdout(chunk: string): void {
    this.#buffer += chunk;
    for (;;) {
      const index = this.#buffer.indexOf("\n");
      if (index < 0) {
        return;
      }
      const line = this.#buffer.slice(0, index + 1);
      this.#buffer = this.#buffer.slice(index + 1);
      this.#lines.push({ kind: "line", line });
    }
  }

  private finish(): void {
    if (this.#ended) {
      return;
    }
    this.#ended = true;
    this.#lines.push({ kind: "end" });
  }

  private streamEndedError(): Error {
    if (this.#processError !== undefined) {
      return this.#processError;
    }
    const stderr = this.#stderr.trim();
    if (stderr.length > 0) {
      return new ControlModeStreamEndedError(`control-mode stream ended: ${stderr}`);
    }
    return new ControlModeStreamEndedError("control-mode stream ended");
  }
}

export function parseControlLine(line: string): ControlEvent | undefined {
  if (!line.startsWith("%")) {
    return undefined;
  }
  if (line.startsWith("%output ")) {
    const [paneId, payload] = splitPayload(line.slice("%output ".length));
    if (paneId === undefined) {
      return new ControlMalformed("%output", line, "missing pane id");
    }
    return new ControlOutput(paneId, decodeTmuxOctal(payload));
  }
  if (line.startsWith("%extended-output ")) {
    const [paneId, rest] = splitPayload(line.slice("%extended-output ".length));
    if (paneId === undefined) {
      return new ControlMalformed("%extended-output", line, "missing pane id");
    }
    const [age, payloadRaw] = splitPayload(rest);
    if (age === undefined) {
      return new ControlMalformed("%extended-output", line, "missing age");
    }
    const payload = payloadRaw.startsWith(": ") ? payloadRaw.slice(2) : payloadRaw;
    const ageMs = parseInteger(age);
    if (ageMs === undefined) {
      return new ControlMalformed("%extended-output", line, "invalid age");
    }
    return new ControlExtendedOutput(paneId, ageMs, decodeTmuxOctal(payload));
  }

  const prefix = line.split(" ", 1)[0] ?? line;
  if (prefix === "%exit") {
    const reason = line.slice("%exit".length).trim();
    return new ControlExit(reason || undefined);
  }
  return new ControlNotification(prefix, line);
}

export function decodeTmuxOctal(value: string): Buffer {
  const chunks: number[] = [];
  let index = 0;
  while (index < value.length) {
    if (
      value[index] === "\\" &&
      index + 3 < value.length &&
      isOctal(value.slice(index + 1, index + 4))
    ) {
      chunks.push(Number.parseInt(value.slice(index + 1, index + 4), 8));
      index += 4;
      continue;
    }

    const codePoint = value.codePointAt(index);
    if (codePoint === undefined) {
      break;
    }
    chunks.push(...Buffer.from(String.fromCodePoint(codePoint), "utf8"));
    index += codePoint > 0xffff ? 2 : 1;
  }
  return Buffer.from(chunks);
}

function splitPayload(value: string): [string | undefined, string] {
  const separator = value.indexOf(" ");
  if (separator <= 0) {
    return [undefined, ""];
  }
  return [value.slice(0, separator), value.slice(separator + 1)];
}

function isOctal(value: string): boolean {
  return /^[0-7]{3}$/.test(value);
}

function parseInteger(value: string): number | undefined {
  if (!/^-?[0-9]+$/.test(value)) {
    return undefined;
  }
  return Number.parseInt(value, 10);
}

function controlCommandKey(line: string): string | undefined {
  const parts = line.trim().split(/\s+/);
  if (parts.length < 4) {
    return undefined;
  }
  // RMUX control mode correlates command boundaries on time, number, and flags.
  return parts.slice(1, 4).join(" ");
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function waitForChildClose(
  child: ChildProcessWithoutNullStreams,
  timeoutMs: number,
): Promise<void> {
  if (isChildClosed(child)) {
    return Promise.resolve();
  }
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error("timed out waiting for control-mode process"));
    }, timeoutMs);
    const onClose = (): void => {
      cleanup();
      resolve();
    };
    const cleanup = (): void => {
      clearTimeout(timer);
      child.off("close", onClose);
    };
    child.on("close", onClose);
  });
}

function isChildClosed(child: ChildProcessWithoutNullStreams): boolean {
  return child.exitCode !== null || child.signalCode !== null;
}

type ControlLineQueueItem =
  | { readonly kind: "line"; readonly line: string }
  | { readonly kind: "end" };

class AsyncQueue<T extends NonNullable<unknown>> {
  readonly #items: T[] = [];
  readonly #waiters: Array<(value: T) => void> = [];

  isEmpty(): boolean {
    return this.#items.length === 0;
  }

  push(value: T): void {
    const waiter = this.#waiters.shift();
    if (waiter !== undefined) {
      waiter(value);
      return;
    }
    this.#items.push(value);
  }

  shift(timeoutMs?: number): Promise<T> {
    if (this.#items.length > 0) {
      const item = this.#items.shift();
      if (item !== undefined) {
        return Promise.resolve(item);
      }
    }
    return new Promise((resolve, reject) => {
      let timer: NodeJS.Timeout | undefined;
      const waiter = (value: T): void => {
        if (timer !== undefined) {
          clearTimeout(timer);
        }
        resolve(value);
      };
      this.#waiters.push(waiter);
      if (timeoutMs !== undefined) {
        timer = setTimeout(() => {
          const index = this.#waiters.indexOf(waiter);
          if (index >= 0) {
            this.#waiters.splice(index, 1);
          }
          reject(new Error("timed out waiting for control-mode event"));
        }, timeoutMs);
      }
    });
  }
}
