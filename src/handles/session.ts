import type { CommandRun } from "../command.js";
import { ensureServerCompatible } from "../compatibility.js";
import type { Rmux } from "../rmux.js";
import type { CommandArgument, JsonObject, NewWindowOptions } from "../types.js";
import { parseWindowIndex, requiredInteger } from "../validation.js";
import { Window } from "./window.js";

export class Session {
  readonly server: Rmux;
  readonly name: string;
  readonly target: string;

  constructor(server: Rmux, name: string, target = name) {
    this.server = server;
    this.name = name;
    this.target = target;
  }

  async listWindows(): Promise<JsonObject[]> {
    return this.server.listWindows({ target: this.target });
  }

  async windows(): Promise<Window[]> {
    return (await this.listWindows()).map((window) => {
      return new Window(
        this.server,
        this.name,
        this.target,
        requiredInteger(window["window_index"], "list-windows row", "window_index"),
      );
    });
  }

  window(index: number): Window {
    return new Window(this.server, this.name, this.target, index);
  }

  pane(windowIndex = 0, paneIndex = 0): import("./pane.js").Pane {
    return this.window(windowIndex).pane(paneIndex);
  }

  async rename(name: string): Promise<Session> {
    await ensureServerCompatible(this.server);
    await this.server.cmd("rename-session", "-t", this.target, name, { check: true });
    return new Session(this.server, name, this.target.startsWith("$") ? this.target : name);
  }

  async kill(): Promise<CommandRun> {
    await ensureServerCompatible(this.server);
    return this.server.cmd("kill-session", "-t", this.target, { check: true });
  }

  async newWindow(options: NewWindowOptions = {}): Promise<Window> {
    await ensureServerCompatible(this.server);
    const args: CommandArgument[] = [
      "new-window",
      "-P",
      "-F",
      "#{window_index}",
      "-t",
      this.target,
    ];
    if (options.detached ?? true) {
      args.push("-d");
    }
    if (options.name !== undefined) {
      args.push("-n", options.name);
    }
    if (options.shellCommand !== undefined) {
      args.push(options.shellCommand);
    }
    const run = await this.server.cmd(...args, { check: true });
    return new Window(
      this.server,
      this.name,
      this.target,
      parseWindowIndex(run.stdout, "new-window output"),
    );
  }
}
