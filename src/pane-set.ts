import type { CommandRun } from "./command.js";
import { deadlineExpired, deadlineFromNow, durationMilliseconds, sleep } from "./duration.js";
import type { Pane } from "./handles/pane.js";
import type { PaneSnapshot } from "./snapshot.js";
import type { Duration } from "./types.js";

export class PaneSetOutcome {
  readonly matched: readonly Pane[];
  readonly snapshots: readonly PaneSnapshot[];

  constructor(matched: readonly Pane[], snapshots: readonly PaneSnapshot[]) {
    this.matched = [...matched];
    this.snapshots = [...snapshots];
  }
}

export class PaneSet {
  readonly panes: readonly Pane[];

  constructor(panes: Iterable<Pane>) {
    this.panes = [...panes];
  }

  get length(): number {
    return this.panes.length;
  }

  [Symbol.iterator](): Iterator<Pane> {
    return this.panes[Symbol.iterator]();
  }

  isEmpty(): boolean {
    return this.panes.length === 0;
  }

  async broadcastText(text: string): Promise<CommandRun[]> {
    return Promise.all(this.panes.map((pane) => pane.sendText(text)));
  }

  async broadcastKey(key: string): Promise<CommandRun[]> {
    return Promise.all(this.panes.map((pane) => pane.sendKeys(key)));
  }

  async snapshotAll(): Promise<PaneSnapshot[]> {
    const snapshots: PaneSnapshot[] = [];
    for (const pane of this.panes) {
      snapshots.push(await pane.snapshot());
    }
    return snapshots;
  }

  expectAll(): PaneSetExpectation {
    return new PaneSetExpectation(this, "all");
  }

  expectAny(): PaneSetExpectation {
    return new PaneSetExpectation(this, "any");
  }

  waitAll(): PaneSetExpectation {
    return this.expectAll();
  }

  waitAny(): PaneSetExpectation {
    return this.expectAny();
  }
}

type PaneSetMode = "all" | "any";

export class PaneSetExpectation {
  readonly #paneSet: PaneSet;
  readonly #mode: PaneSetMode;
  readonly #text: string | undefined;
  readonly #interval: Duration;

  constructor(
    paneSet: PaneSet,
    mode: PaneSetMode,
    options: { readonly text?: string; readonly interval?: Duration } = {},
  ) {
    this.#paneSet = paneSet;
    this.#mode = mode;
    this.#text = options.text;
    this.#interval = options.interval ?? 0.05;
  }

  visibleTextContains(text: string, options: { readonly interval?: Duration } = {}): PaneSetExpectation {
    return new PaneSetExpectation(this.#paneSet, this.#mode, {
      text,
      interval: options.interval ?? 0.05,
    });
  }

  async timeout(value: Duration): Promise<PaneSetOutcome> {
    if (this.#text === undefined) {
      throw new Error("choose an expectation before setting a timeout");
    }

    const deadline = deadlineFromNow(value);
    const intervalMs = durationMilliseconds(this.#interval);

    for (;;) {
      const matched: Pane[] = [];
      const snapshots: PaneSnapshot[] = [];
      for (const pane of this.#paneSet) {
        const snapshot = await pane.snapshot();
        if (snapshot.visibleText.includes(this.#text)) {
          matched.push(pane);
          snapshots.push(snapshot);
        }
      }

      if (this.#mode === "all" && matched.length === this.#paneSet.length) {
        return new PaneSetOutcome(matched, snapshots);
      }
      if (this.#mode === "any" && matched.length > 0) {
        return new PaneSetOutcome(matched, snapshots);
      }
      if (deadlineExpired(deadline)) {
        throw new Error(
          `pane set did not match visible text before timeout: ${JSON.stringify(this.#text)}`,
        );
      }
      await sleep(intervalMs);
    }
  }
}
