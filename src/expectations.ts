import { deadlineExpired, deadlineFromNow, durationMilliseconds, sleep } from "./duration.js";
import type { Duration } from "./types.js";
import type { Pane } from "./handles/pane.js";

export class TextMatch {
  readonly text: string;
  readonly row: number;
  readonly column: number;

  constructor(text: string, row: number, column: number) {
    this.text = text;
    this.row = row;
    this.column = column;
  }
}

type TextExpectationMode = "contains" | "equals";

export class TextExpectation {
  readonly #pane: Pane;
  readonly #mode: TextExpectationMode | undefined;
  readonly #expected: string | undefined;
  readonly #interval: Duration;

  constructor(
    pane: Pane,
    options: {
      readonly mode?: TextExpectationMode;
      readonly expected?: string;
      readonly interval?: Duration;
    } = {},
  ) {
    this.#pane = pane;
    this.#mode = options.mode;
    this.#expected = options.expected;
    this.#interval = options.interval ?? 0.05;
  }

  toContain(text: string, options: { readonly interval?: Duration } = {}): TextExpectation {
    return new TextExpectation(this.#pane, {
      mode: "contains",
      expected: text,
      interval: options.interval ?? 0.05,
    });
  }

  toHaveText(text: string, options: { readonly interval?: Duration } = {}): TextExpectation {
    return new TextExpectation(this.#pane, {
      mode: "equals",
      expected: text,
      interval: options.interval ?? 0.05,
    });
  }

  async timeout(value: Duration): Promise<TextMatch> {
    if (this.#mode === undefined || this.#expected === undefined) {
      throw new Error("choose an expectation before setting a timeout");
    }
    if (this.#mode === "contains") {
      return this.#pane.waitForText(this.#expected, {
        timeout: value,
        interval: this.#interval,
      });
    }
    return this.#pane.waitForExactText(this.#expected, {
      timeout: value,
      interval: this.#interval,
    });
  }
}

export async function pollUntil<T>(
  timeout: Duration,
  interval: Duration,
  callback: () => Promise<T | undefined>,
  failure: () => Error,
): Promise<T> {
  const deadline = deadlineFromNow(timeout);
  const intervalMs = durationMilliseconds(interval);

  for (;;) {
    const result = await callback();
    if (result !== undefined) {
      return result;
    }
    if (deadlineExpired(deadline)) {
      throw failure();
    }
    await sleep(intervalMs);
  }
}

export function rowColumn(text: string, index: number): [row: number, column: number] {
  const before = text.slice(0, index);
  const row = countOccurrences(before, "\n");
  const lineStart = before.lastIndexOf("\n");
  if (lineStart < 0) {
    return [row, before.length];
  }
  return [row, before.length - lineStart - 1];
}

function countOccurrences(text: string, needle: string): number {
  let count = 0;
  let index = text.indexOf(needle);
  while (index >= 0) {
    count += 1;
    index = text.indexOf(needle, index + needle.length);
  }
  return count;
}
