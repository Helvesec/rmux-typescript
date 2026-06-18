import {
  ControlExit,
  ControlExtendedOutput,
  ControlModeClient,
  ControlOutput,
} from "./control.js";
import { deadlineFromNow, remainingMilliseconds } from "./duration.js";
import { PaneSnapshot } from "./snapshot.js";
import type { Duration } from "./types.js";
import type { Pane } from "./handles/pane.js";

export class PaneOutputChunk {
  readonly paneId: string;
  readonly data: Buffer;
  readonly ageMs?: number;

  constructor(paneId: string, data: Buffer, ageMs?: number) {
    this.paneId = paneId;
    this.data = data;
    if (ageMs !== undefined) {
      this.ageMs = ageMs;
    }
  }

  get pane_id(): string {
    return this.paneId;
  }

  get age_ms(): number | undefined {
    return this.ageMs;
  }
}

export class PaneOutputStream {
  readonly #paneId: string | undefined;
  readonly #control: ControlModeClient;

  private constructor(paneId: string | undefined, control: ControlModeClient) {
    this.#paneId = paneId;
    this.#control = control;
  }

  static async open(pane: Pane): Promise<PaneOutputStream> {
    const paneId = await pane.id();
    const control = new ControlModeClient(await pane.server.controlMode());
    try {
      await control.runCommand(`attach-session -t ${paneId}`);
    } catch (error) {
      await control.close();
      throw error;
    }
    return new PaneOutputStream(paneId, control);
  }

  async close(): Promise<void> {
    await this.#control.close();
  }

  async next(timeout?: Duration): Promise<PaneOutputChunk> {
    const deadline = timeout === undefined ? undefined : deadlineFromNow(timeout);
    for (;;) {
      const event = await this.#control.readEvent(
        deadline === undefined ? undefined : { milliseconds: remainingMilliseconds(deadline) },
      );
      if (event instanceof ControlExit) {
        throw new Error("control-mode stream exited");
      }
      if (event instanceof ControlOutput || event instanceof ControlExtendedOutput) {
        if (this.#paneId === undefined || event.paneId === this.#paneId) {
          return new PaneOutputChunk(
            event.paneId,
            event.data,
            event instanceof ControlExtendedOutput ? event.ageMs : undefined,
          );
        }
      }
    }
  }
}

export class PaneLineStream {
  readonly #output: PaneOutputStream;
  readonly #buffer: number[] = [];
  readonly #pending: string[] = [];

  constructor(output: PaneOutputStream) {
    this.#output = output;
  }

  async close(): Promise<void> {
    await this.#output.close();
  }

  async next(timeout?: Duration): Promise<string> {
    const deadline = timeout === undefined ? undefined : deadlineFromNow(timeout);
    for (;;) {
      const pending = this.#pending.shift();
      if (pending !== undefined) {
        return pending;
      }
      const chunk = await this.#output.next(
        deadline === undefined ? undefined : { milliseconds: remainingMilliseconds(deadline) },
      );
      this.feed(chunk.data);
    }
  }

  private feed(data: Buffer): void {
    for (const byte of data) {
      if (byte === 0x0a) {
        let line = Buffer.from(this.#buffer);
        this.#buffer.length = 0;
        if (line.at(-1) === 0x0d) {
          line = line.subarray(0, -1);
        }
        this.#pending.push(line.toString("utf8"));
      } else {
        this.#buffer.push(byte);
      }
    }
  }
}

export class PaneRenderStream {
  readonly #pane: Pane;
  readonly #output: PaneOutputStream;

  private constructor(pane: Pane, output: PaneOutputStream) {
    this.#pane = pane;
    this.#output = output;
  }

  static async open(pane: Pane): Promise<PaneRenderStream> {
    return new PaneRenderStream(pane, await pane.outputStream());
  }

  async close(): Promise<void> {
    await this.#output.close();
  }

  async next(timeout?: Duration): Promise<PaneSnapshot> {
    await this.#output.next(timeout);
    return this.#pane.snapshot();
  }
}
