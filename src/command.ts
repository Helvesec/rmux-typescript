import { RmuxCommandError } from "./errors.js";

export class CommandRun {
  readonly args: readonly string[];
  readonly returnCode: number;
  readonly signal?: NodeJS.Signals;
  readonly stdout: string;
  readonly stderr: string;

  constructor(
    args: readonly string[],
    returnCode: number,
    stdout: string,
    stderr: string,
    signal?: NodeJS.Signals,
  ) {
    this.args = [...args];
    this.returnCode = returnCode;
    if (signal !== undefined) {
      this.signal = signal;
    }
    this.stdout = stdout;
    this.stderr = stderr;
  }

  get returncode(): number {
    return this.returnCode;
  }

  checkReturnCode(): this {
    if (this.returnCode !== 0) {
      throw new RmuxCommandError(this);
    }
    return this;
  }
}
