import type { CommandRun } from "../command.js";
import { ensureServerCompatible } from "../compatibility.js";
import { deadlineExpired, deadlineFromNow, durationMilliseconds, sleep } from "../duration.js";
import { rowColumn, TextExpectation, TextMatch } from "../expectations.js";
import { PaneExitState } from "../lifecycle.js";
import { TextLocator } from "../locators.js";
import type { Rmux } from "../rmux.js";
import { PaneSnapshot } from "../snapshot.js";
import { PaneLineStream, PaneOutputStream, PaneRenderStream } from "../streams.js";
import type {
  CaptureOptions,
  CommandArgument,
  Duration,
  ResizeOptions,
  RespawnOptions,
  SplitOptions,
} from "../types.js";
import { parsePaneId } from "../validation.js";

export class Pane {
  readonly server: Rmux;
  readonly target: string;

  constructor(server: Rmux, target: string) {
    this.server = server;
    this.target = target;
  }

  async sendKeys(...keys: CommandArgument[]): Promise<CommandRun> {
    return this.server.sendKeys(this.target, ...keys);
  }

  async sendText(text: string): Promise<CommandRun> {
    return this.server.sendText(this.target, text);
  }

  async select(): Promise<CommandRun> {
    await ensureServerCompatible(this.server);
    return this.server.cmd("select-pane", "-t", this.target, { check: true });
  }

  async resize(options: ResizeOptions): Promise<CommandRun> {
    await ensureServerCompatible(this.server);
    const args: CommandArgument[] = ["resize-pane", "-t", this.target];
    if (options.width !== undefined) {
      args.push("-x", options.width);
    }
    if (options.height !== undefined) {
      args.push("-y", options.height);
    }
    return this.server.cmd(...args, { check: true });
  }

  async split(options: SplitOptions = {}): Promise<Pane> {
    await ensureServerCompatible(this.server);
    const direction = options.direction ?? "vertical";
    const args: CommandArgument[] = [
      "split-window",
      "-P",
      "-F",
      "#{pane_id}",
      "-t",
      this.target,
    ];
    if (direction === "horizontal" || direction === "h") {
      args.push("-h");
    } else if (direction === "vertical" || direction === "v") {
      args.push("-v");
    } else {
      throw new Error("direction must be 'horizontal' or 'vertical'");
    }
    if (options.size !== undefined) {
      args.push("-l", options.size);
    }
    if (options.shellCommand !== undefined) {
      args.push(options.shellCommand);
    }
    const run = await this.server.cmd(...args, { check: true });
    return new Pane(this.server, parsePaneId(run.stdout, "split-window output"));
  }

  async respawn(options: RespawnOptions = {}): Promise<CommandRun> {
    await ensureServerCompatible(this.server);
    const args: CommandArgument[] = ["respawn-pane", "-t", this.target];
    if (options.kill) {
      args.push("-k");
    }
    if (options.shellCommand !== undefined) {
      args.push(options.shellCommand);
    }
    return this.server.cmd(...args, { check: true });
  }

  async close(): Promise<CommandRun> {
    await ensureServerCompatible(this.server);
    return this.server.cmd("kill-pane", "-t", this.target, { check: true });
  }

  async capture(options: CaptureOptions = {}): Promise<string> {
    return this.server.capturePane({ target: this.target, ...options });
  }

  async captureText(options: CaptureOptions = {}): Promise<string> {
    return (await this.snapshot(options)).visibleText;
  }

  async snapshot(options: CaptureOptions = {}): Promise<PaneSnapshot> {
    return new PaneSnapshot(await this.capture(options));
  }

  getByText(text: string): TextLocator {
    return new TextLocator(this, text);
  }

  locator(text: string): TextLocator {
    return this.getByText(text);
  }

  async id(): Promise<string> {
    await ensureServerCompatible(this.server);
    const run = await this.server.cmd("display-message", "-p", "-t", this.target, "#{pane_id}", {
      check: true,
    });
    return parsePaneId(run.stdout, "display-message #{pane_id}");
  }

  async outputStream(): Promise<PaneOutputStream> {
    return PaneOutputStream.open(this);
  }

  async lineStream(): Promise<PaneLineStream> {
    return new PaneLineStream(await this.outputStream());
  }

  async renderStream(): Promise<PaneRenderStream> {
    return PaneRenderStream.open(this);
  }

  async waitForText(
    text: string,
    options: { readonly timeout?: Duration; readonly interval?: Duration } = {},
  ): Promise<TextMatch> {
    return this.waitForTextInner(text, false, options.timeout ?? 5, options.interval ?? 0.05);
  }

  async waitForExactText(
    text: string,
    options: { readonly timeout?: Duration; readonly interval?: Duration } = {},
  ): Promise<TextMatch> {
    return this.waitForTextInner(text, true, options.timeout ?? 5, options.interval ?? 0.05);
  }

  expectVisibleText(): TextExpectation {
    return new TextExpectation(this);
  }

  async waitForExit(
    options: { readonly timeout?: Duration; readonly interval?: Duration } = {},
  ): Promise<PaneExitState> {
    const timeout = options.timeout ?? 5;
    const intervalMs = durationMilliseconds(options.interval ?? 0.05);
    const deadline = deadlineFromNow(timeout);

    for (;;) {
      const state = await this.exitState();
      if (state.dead) {
        return state;
      }
      if (deadlineExpired(deadline)) {
        throw new Error(`pane did not exit before timeout: ${this.target}`);
      }
      await sleep(intervalMs);
    }
  }

  private async waitForTextInner(
    text: string,
    exact: boolean,
    timeout: Duration,
    interval: Duration,
  ): Promise<TextMatch> {
    const intervalMs = durationMilliseconds(interval);
    const deadline = deadlineFromNow(timeout);

    for (;;) {
      const captured = await this.captureText();
      if (exact) {
        if (captured.replace(/\n+$/, "") === text) {
          const found = captured.indexOf(text);
          const [row, column] = rowColumn(captured, found < 0 ? 0 : found);
          return new TextMatch(text, row, column);
        }
      } else {
        const found = captured.indexOf(text);
        if (found >= 0) {
          const [row, column] = rowColumn(captured, found);
          return new TextMatch(text, row, column);
        }
      }
      if (deadlineExpired(deadline)) {
        throw new Error(`text not found before timeout: ${JSON.stringify(text)}`);
      }
      await sleep(intervalMs);
    }
  }

  private async exitState(): Promise<PaneExitState> {
    await ensureServerCompatible(this.server);
    const run = await this.server.cmd(
      "display-message",
      "-p",
      "-t",
      this.target,
      "#{pane_dead}:#{pane_dead_status}",
      { check: true },
    );
    const output = run.stdout.trim();
    const separator = output.indexOf(":");
    const dead = separator < 0 ? output : output.slice(0, separator);
    const status = separator < 0 ? "" : output.slice(separator + 1);
    if (dead !== "1" && dead !== "true") {
      return new PaneExitState(false);
    }
    return new PaneExitState(true, parseExitStatus(status));
  }
}

function parseExitStatus(value: string): number | undefined {
  if (!/^[0-9]+$/.test(value)) {
    return undefined;
  }
  return Number.parseInt(value, 10);
}
