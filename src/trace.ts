import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { Pane } from "./handles/pane.js";
import type { JsonObject, JsonValue } from "./types.js";

export interface TraceEvent {
  readonly timestamp_ms: number;
  readonly kind: string;
  readonly payload: JsonObject;
}

export class RmuxTraceBuilder {
  #maxEvents = 100_000;

  maxEvents(value: number): this {
    if (!Number.isInteger(value) || value < 0) {
      throw new RangeError("maxEvents must be a non-negative integer");
    }
    this.#maxEvents = value;
    return this;
  }

  start(): TraceSession {
    const trace = new TraceSession(this.#maxEvents);
    trace.record("trace.start", {});
    return trace;
  }
}

export class TraceSession {
  readonly #maxEvents: number;
  readonly #events: TraceEvent[] = [];

  constructor(maxEvents: number) {
    this.#maxEvents = maxEvents;
  }

  recordAction(action: string): void {
    this.record("action", { action });
  }

  async recordSnapshot(pane: Pane): Promise<void> {
    const snapshot = await pane.snapshot();
    this.record("snapshot", {
      pane: pane.target,
      visible_text: snapshot.visibleText,
    });
  }

  async stop(directory: string): Promise<string> {
    this.record("trace.stop", {});
    await mkdir(directory, { recursive: true });
    const output = join(directory, "trace.jsonl");
    const content =
      this.#events.length === 0
        ? ""
        : this.#events.map((event) => JSON.stringify(event)).join("\n") + "\n";
    await writeFile(
      output,
      content,
      "utf8",
    );
    return output;
  }

  record(kind: string, payload: JsonObject): void {
    const jsonPayload = copyJsonObject(payload, "payload");
    if (this.#maxEvents <= 0) {
      return;
    }
    if (this.#events.length === this.#maxEvents) {
      this.#events.shift();
    }
    this.#events.push({
      timestamp_ms: Date.now(),
      kind,
      payload: jsonPayload,
    });
  }
}

function copyJsonObject(value: JsonObject, path: string): JsonObject {
  if (!isPlainObject(value)) {
    throw new TypeError(`${path} must be a JSON object`);
  }
  const copy: JsonObject = {};
  for (const [key, item] of Object.entries(value)) {
    copy[key] = copyJsonValue(item, `${path}.${key}`);
  }
  return copy;
}

function copyJsonValue(value: JsonValue, path: string): JsonValue {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "boolean"
  ) {
    return value;
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new TypeError(`${path} must be a finite JSON number`);
    }
    return value;
  }
  if (Array.isArray(value)) {
    return value.map((item, index) => copyJsonValue(item, `${path}[${index}]`));
  }
  return copyJsonObject(value, path);
}

function isPlainObject(value: unknown): value is JsonObject {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}
