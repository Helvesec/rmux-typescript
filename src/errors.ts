import type { CommandRun } from "./command.js";

export class RmuxCommandError extends Error {
  readonly run: CommandRun;

  constructor(run: CommandRun) {
    super(commandFailureMessage(run));
    this.name = "RmuxCommandError";
    this.run = run;
  }
}

export class RmuxCompatibilityError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RmuxCompatibilityError";
  }
}

function commandFailureMessage(run: CommandRun): string {
  const command = commandName(run.args);
  const outcome =
    run.signal === undefined
      ? `status ${run.returnCode}`
      : `signal ${run.signal}`;
  const stderr = run.stderr.trim();
  const suffix = stderr.length > 0 ? `: ${stderr}` : "";
  return `rmux command ${JSON.stringify(command)} failed with ${outcome}${suffix}`;
}

function commandName(args: readonly string[]): string {
  for (let index = 1; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "-S" || arg === "-L") {
      index += 1;
      continue;
    }
    if (arg !== undefined) {
      return arg;
    }
  }
  return args[0] ?? "rmux";
}
