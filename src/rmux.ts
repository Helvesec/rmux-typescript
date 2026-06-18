import type { ChildProcessWithoutNullStreams } from "node:child_process";
import { CommandRun } from "./command.js";
import {
  ControlModeClient,
  spawnControlProcess,
  waitForControlProcessSpawn,
} from "./control.js";
import { RmuxCompatibilityError } from "./errors.js";
import { Session } from "./handles/session.js";
import { PaneSet } from "./pane-set.js";
import { runProcess } from "./process.js";
import { RmuxBuilder } from "./builder.js";
import { RmuxTraceBuilder } from "./trace.js";
import { isJsonObject, requiredSessionId, requiredString } from "./validation.js";
import type {
  CommandArgument,
  CommandOptions,
  CaptureOptions,
  EnsureSessionOptions,
  Environment,
  JsonObject,
  JsonValue,
  RmuxOptions,
} from "./types.js";

export const BINARY_CONTRACT_VERSION = 1;

export class Rmux {
  readonly binary: string;
  readonly socketPath: string | undefined;
  readonly socketName: string | undefined;
  readonly checkCompatibility: boolean;
  readonly env: Environment | undefined;
  readonly cwd: string | undefined;
  #capabilities?: JsonObject;

  static builder(): RmuxBuilder {
    return new RmuxBuilder();
  }

  constructor(options: RmuxOptions = {}) {
    if (options.socketPath !== undefined && options.socketName !== undefined) {
      throw new Error("choose only one of socketPath or socketName");
    }

    this.binary = options.binary ?? "rmux";
    this.socketPath = options.socketPath;
    this.socketName = options.socketName;
    this.checkCompatibility = options.checkCompatibility ?? true;
    this.env = options.env === undefined ? undefined : { ...options.env };
    this.cwd = options.cwd;
  }

  async cmd(...argsAndOptions: Array<CommandArgument | CommandOptions>): Promise<CommandRun> {
    const { args, options } = splitCommandArguments(argsAndOptions);
    const argv = this.argv(args);
    const completed = await runProcess(argv, {
      cwd: this.cwd,
      env: this.env,
    });
    const run = new CommandRun(
      argv,
      completed.code,
      completed.stdout,
      completed.stderr,
      completed.signal,
    );
    if (options.check) {
      run.checkReturnCode();
    }
    return run;
  }

  async capabilities(): Promise<JsonObject> {
    if (this.#capabilities === undefined) {
      const capabilities = await this.jsonObject("capabilities", "--json");
      if (this.checkCompatibility) {
        this.validateCapabilities(capabilities);
      }
      this.#capabilities = capabilities;
    }
    return { ...this.#capabilities };
  }

  async startServer(): Promise<CommandRun> {
    return this.cmd("start-server", { check: true });
  }

  async killServer(options: { readonly check?: boolean } = {}): Promise<CommandRun> {
    return this.cmd("kill-server", { check: options.check ?? false });
  }

  async listSessions(): Promise<JsonObject[]> {
    await this.ensureCompatible();
    return this.jsonList("list-sessions", "--json");
  }

  async sessions(): Promise<Session[]> {
    return (await this.listSessions()).map((session, index) => {
      return this.sessionFromRow(session, `list-sessions row ${index}`);
    });
  }

  session(name: string): Session {
    return new Session(this, name);
  }

  async ensureSession(
    name: string,
    options: EnsureSessionOptions = {},
  ): Promise<Session> {
    await this.ensureCompatible();
    const run = await this.cmd("has-session", "-t", name);
    if (run.returnCode !== 0) {
      const args: CommandArgument[] = ["new-session"];
      if (options.detached ?? true) {
        args.push("-d");
      }
      args.push("-s", name);
      if (options.shellCommand !== undefined) {
        args.push(options.shellCommand);
      }
      await this.cmd(...args, { check: true });
    }
    return this.sessionForTarget(name, name);
  }

  async listWindows(options: {
    readonly target?: string;
    readonly allSessions?: boolean;
  } = {}): Promise<JsonObject[]> {
    await this.ensureCompatible();
    const args: CommandArgument[] = ["list-windows"];
    if (options.allSessions) {
      args.push("-a");
    }
    if (options.target !== undefined) {
      args.push("-t", options.target);
    }
    args.push("--json");
    return this.jsonList(...args);
  }

  async listPanes(options: {
    readonly target?: string;
    readonly allSessions?: boolean;
  } = {}): Promise<JsonObject[]> {
    await this.ensureCompatible();
    const args: CommandArgument[] = ["list-panes"];
    if (options.allSessions) {
      args.push("-a");
    }
    if (options.target !== undefined) {
      args.push("-t", options.target);
    }
    args.push("--json");
    return this.jsonList(...args);
  }

  async listClients(options: { readonly targetSession?: string } = {}): Promise<JsonObject[]> {
    await this.ensureCompatible();
    const args: CommandArgument[] = ["list-clients"];
    if (options.targetSession !== undefined) {
      args.push("-t", options.targetSession);
    }
    args.push("--json");
    return this.jsonList(...args);
  }

  async sendKeys(target: string, ...keys: CommandArgument[]): Promise<CommandRun> {
    await this.ensureCompatible();
    return this.cmd("send-keys", "-t", target, ...keys, { check: true });
  }

  async sendText(target: string, text: string): Promise<CommandRun> {
    await this.ensureCompatible();
    return this.cmd("send-keys", "-t", target, "-l", text, { check: true });
  }

  async displayMessage(message: string, options: { readonly target?: string } = {}): Promise<JsonObject> {
    await this.ensureCompatible();
    const args: CommandArgument[] = ["display-message", "--json"];
    if (options.target !== undefined) {
      args.push("-t", options.target);
    }
    args.push(message);
    return this.jsonObject(...args);
  }

  async capturePane(options: CaptureOptions & { readonly target?: string | undefined } = {}): Promise<string> {
    await this.ensureCompatible();
    const args: CommandArgument[] = ["capture-pane", "-p"];
    if (options.target !== undefined) {
      args.push("-t", options.target);
    }
    if (options.start !== undefined) {
      args.push("-S", options.start);
    }
    if (options.end !== undefined) {
      args.push("-E", options.end);
    }
    if (options.escapeAnsi) {
      args.push("-e");
    }
    if (options.joinWrapped) {
      args.push("-J");
    }
    return (await this.cmd(...args, { check: true })).stdout;
  }

  async controlMode(): Promise<ChildProcessWithoutNullStreams> {
    await this.ensureCompatible();
    const process = spawnControlProcess({
      binary: this.binary,
      args: this.endpointArgs(["-C"]),
      cwd: this.cwd,
      env: this.env,
    });
    await waitForControlProcessSpawn(process);
    return process;
  }

  async control(): Promise<ControlModeClient> {
    return new ControlModeClient(await this.controlMode());
  }

  paneSet(panes: Iterable<import("./handles/pane.js").Pane>): PaneSet {
    return new PaneSet(panes);
  }

  async broadcastText(
    panes: Iterable<import("./handles/pane.js").Pane>,
    text: string,
  ): Promise<CommandRun[]> {
    return this.paneSet(panes).broadcastText(text);
  }

  async broadcastKey(
    panes: Iterable<import("./handles/pane.js").Pane>,
    key: string,
  ): Promise<CommandRun[]> {
    return this.paneSet(panes).broadcastKey(key);
  }

  tracing(): RmuxTraceBuilder {
    return new RmuxTraceBuilder();
  }

  private async jsonList(...args: CommandArgument[]): Promise<JsonObject[]> {
    const value = await this.jsonValue(...args);
    if (!Array.isArray(value)) {
      throw new TypeError("rmux JSON response is not an array");
    }
    return value.map((item) => {
      if (!isJsonObject(item)) {
        throw new TypeError("rmux JSON array contains a non-object item");
      }
      return item;
    });
  }

  private async jsonObject(...args: CommandArgument[]): Promise<JsonObject> {
    const value = await this.jsonValue(...args);
    if (!isJsonObject(value)) {
      throw new TypeError("rmux JSON response is not an object");
    }
    return value;
  }

  private async jsonValue(...args: CommandArgument[]): Promise<JsonValue> {
    const run = await this.cmd(...args, { check: true });
    try {
      return JSON.parse(run.stdout) as JsonValue;
    } catch (error) {
      throw new TypeError(
        `rmux returned invalid JSON for ${args.map(String).join(" ")}: ${errorMessage(error)}`,
      );
    }
  }

  private async ensureCompatible(): Promise<void> {
    if (this.checkCompatibility) {
      await this.capabilities();
    }
  }

  private async sessionForTarget(target: string, fallbackName: string): Promise<Session> {
    const idMessage = await this.displayMessage("#{session_id}", { target });
    const sessionId = requiredSessionId(
      idMessage["message"],
      `display-message #{session_id} for ${JSON.stringify(target)}`,
    );
    const row = (await this.listSessions()).find((session) => {
      return session["session_id"] === sessionId;
    });
    if (row !== undefined) {
      return this.sessionFromRow(row, `session ${sessionId}`);
    }
    return new Session(this, fallbackName, sessionId);
  }

  private sessionFromRow(session: JsonObject, context: string): Session {
    return new Session(
      this,
      requiredString(session["session_name"], context, "session_name"),
      requiredSessionId(session["session_id"], context),
    );
  }

  private validateCapabilities(capabilities: JsonObject): void {
    const version = capabilities["binary_contract_version"];
    if (version !== BINARY_CONTRACT_VERSION) {
      throw new RmuxCompatibilityError(
        `unsupported rmux binary contract version ${JSON.stringify(
          version,
        )}; expected ${BINARY_CONTRACT_VERSION}`,
      );
    }

    const commands = capabilities["json_commands"];
    const requiredCommands = [
      "capabilities",
      "display-message",
      "list-clients",
      "list-panes",
      "list-sessions",
      "list-windows",
    ];
    if (
      !Array.isArray(commands) ||
      !requiredCommands.every((command) => commands.includes(command))
    ) {
      throw new RmuxCompatibilityError("rmux binary does not advertise required JSON commands");
    }

    const publicContract = capabilities["public_contract"];
    if (!Array.isArray(publicContract) || !publicContract.includes("control-mode")) {
      throw new RmuxCompatibilityError("rmux binary does not advertise control-mode");
    }
  }

  private argv(args: readonly CommandArgument[]): string[] {
    return [this.binary, ...this.endpointArgs(args)];
  }

  private endpointArgs(args: readonly CommandArgument[]): string[] {
    const argv: string[] = [];
    if (this.socketName !== undefined) {
      argv.push("-L", this.socketName);
    }
    if (this.socketPath !== undefined) {
      argv.push("-S", this.socketPath);
    }
    argv.push(...args.map(String));
    return argv;
  }
}

function splitCommandArguments(values: readonly (CommandArgument | CommandOptions)[]): {
  args: CommandArgument[];
  options: CommandOptions;
} {
  const last = values.at(-1);
  if (isCommandOptionsCandidate(last)) {
    return {
      args: values.slice(0, -1) as CommandArgument[],
      options: parseCommandOptions(last),
    };
  }
  return {
    args: values as CommandArgument[],
    options: {},
  };
}

function isCommandOptionsCandidate(value: unknown): value is Record<string, unknown> {
  if (!isJsonObject(value)) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function parseCommandOptions(value: Record<string, unknown>): CommandOptions {
  for (const key of Object.keys(value)) {
    if (key !== "check") {
      throw new TypeError(`unknown rmux command option: ${key}`);
    }
  }
  if (value["check"] !== undefined && typeof value["check"] !== "boolean") {
    throw new TypeError("rmux command option check must be a boolean");
  }
  return value["check"] === undefined ? {} : { check: value["check"] };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
