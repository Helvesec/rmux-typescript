import type { CommandRun } from "../command.js";
import { ensureServerCompatible } from "../compatibility.js";
import type { Rmux } from "../rmux.js";
import type { CommandArgument, JsonObject, ResizeOptions } from "../types.js";
import { requiredPaneId } from "../validation.js";
import { Pane } from "./pane.js";

export class Window {
  readonly server: Rmux;
  readonly sessionName: string;
  readonly sessionTarget: string;
  readonly index: number;

  constructor(server: Rmux, sessionName: string, sessionTarget: string, index: number) {
    this.server = server;
    this.sessionName = sessionName;
    this.sessionTarget = sessionTarget;
    this.index = index;
  }

  get target(): string {
    return `${this.sessionTarget}:${this.index}`;
  }

  async listPanes(): Promise<JsonObject[]> {
    return this.server.listPanes({ target: this.target });
  }

  async panes(): Promise<Pane[]> {
    const panes: Pane[] = [];
    for (const [index, pane] of (await this.listPanes()).entries()) {
      panes.push(new Pane(this.server, requiredPaneId(pane["pane_id"], `list-panes row ${index}`)));
    }
    return panes;
  }

  pane(index: number): Pane {
    return new Pane(this.server, `${this.target}.${index}`);
  }

  async select(): Promise<CommandRun> {
    await ensureServerCompatible(this.server);
    return this.server.cmd("select-window", "-t", this.target, { check: true });
  }

  async rename(name: string): Promise<CommandRun> {
    await ensureServerCompatible(this.server);
    return this.server.cmd("rename-window", "-t", this.target, name, { check: true });
  }

  async resize(options: ResizeOptions): Promise<CommandRun> {
    await ensureServerCompatible(this.server);
    const args: CommandArgument[] = ["resize-window", "-t", this.target];
    if (options.width !== undefined) {
      args.push("-x", options.width);
    }
    if (options.height !== undefined) {
      args.push("-y", options.height);
    }
    return this.server.cmd(...args, { check: true });
  }

  async selectLayout(layout: string): Promise<CommandRun> {
    await ensureServerCompatible(this.server);
    return this.server.cmd("select-layout", "-t", this.target, layout, { check: true });
  }

  async close(): Promise<CommandRun> {
    await ensureServerCompatible(this.server);
    return this.server.cmd("kill-window", "-t", this.target, { check: true });
  }
}
