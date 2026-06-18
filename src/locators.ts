import { deadlineExpired, deadlineFromNow, durationMilliseconds, sleep } from "./duration.js";
import type { Duration } from "./types.js";
import type { Pane } from "./handles/pane.js";
import type { TextMatch } from "./expectations.js";

export class TextLocator {
  readonly pane: Pane;
  readonly text: string;
  readonly index?: number;

  constructor(pane: Pane, text: string, index?: number) {
    this.pane = pane;
    this.text = text;
    if (index !== undefined) {
      this.index = index;
    }
  }

  async all(): Promise<readonly TextMatch[]> {
    return (await this.pane.snapshot()).findAllText(this.text);
  }

  async count(): Promise<number> {
    return (await this.all()).length;
  }

  first(): TextLocator {
    return new TextLocator(this.pane, this.text, 0);
  }

  last(): TextLocator {
    return new TextLocator(this.pane, this.text, -1);
  }

  nth(index: number): TextLocator {
    return new TextLocator(this.pane, this.text, index);
  }

  async isVisible(): Promise<boolean> {
    return this.resolve(await this.all()) !== undefined;
  }

  expect(): LocatorExpectation {
    return new LocatorExpectation(this);
  }

  resolve(matches: readonly TextMatch[]): TextMatch | undefined {
    if (this.index === undefined) {
      return matches[0];
    }
    const normalized = this.index < 0 ? matches.length + this.index : this.index;
    return matches[normalized];
  }
}

type LocatorExpectationMode = "visible" | "text" | "count";

export class LocatorExpectation {
  readonly #locator: TextLocator;
  readonly #mode: LocatorExpectationMode | undefined;
  readonly #expected: string | number | undefined;
  readonly #interval: Duration;

  constructor(
    locator: TextLocator,
    options: {
      readonly mode?: LocatorExpectationMode;
      readonly expected?: string | number;
      readonly interval?: Duration;
    } = {},
  ) {
    this.#locator = locator;
    this.#mode = options.mode;
    this.#expected = options.expected;
    this.#interval = options.interval ?? 0.05;
  }

  toBeVisible(options: { readonly interval?: Duration } = {}): LocatorExpectation {
    return new LocatorExpectation(this.#locator, {
      mode: "visible",
      interval: options.interval ?? 0.05,
    });
  }

  toHaveText(text: string, options: { readonly interval?: Duration } = {}): LocatorExpectation {
    return new LocatorExpectation(this.#locator, {
      mode: "text",
      expected: text,
      interval: options.interval ?? 0.05,
    });
  }

  toHaveCount(count: number, options: { readonly interval?: Duration } = {}): LocatorExpectation {
    return new LocatorExpectation(this.#locator, {
      mode: "count",
      expected: count,
      interval: options.interval ?? 0.05,
    });
  }

  async timeout(value: Duration): Promise<TextMatch | number> {
    if (this.#mode === undefined) {
      throw new Error("choose an expectation before setting a timeout");
    }

    const deadline = deadlineFromNow(value);
    const intervalMs = durationMilliseconds(this.#interval);
    let lastCount = 0;

    for (;;) {
      const matches = await this.#locator.all();
      lastCount = matches.length;
      const match = this.#locator.resolve(matches);

      if (this.#mode === "visible" && match !== undefined) {
        return match;
      }
      if (this.#mode === "text" && match !== undefined && match.text === this.#expected) {
        return match;
      }
      if (this.#mode === "count" && lastCount === this.#expected) {
        return lastCount;
      }
      if (deadlineExpired(deadline)) {
        throw new Error(this.failureMessage(lastCount));
      }

      await sleep(intervalMs);
    }
  }

  private failureMessage(lastCount: number): string {
    if (this.#mode === "visible") {
      return `text not visible before timeout: ${JSON.stringify(this.#locator.text)}`;
    }
    if (this.#mode === "text") {
      return `text locator did not resolve to expected text before timeout: ${JSON.stringify(
        this.#locator.text,
      )} != ${JSON.stringify(this.#expected)}`;
    }
    if (this.#mode === "count") {
      return `text locator count did not match before timeout: ${lastCount} != ${this.#expected}`;
    }
    return "locator expectation failed before timeout";
  }
}
