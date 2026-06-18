import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { constants } from "node:os";
import type { Environment } from "./types.js";

export interface ProcessOptions {
  readonly cwd?: string | undefined;
  readonly env?: Environment | undefined;
}

export interface ProcessResult {
  readonly code: number;
  readonly signal?: NodeJS.Signals | undefined;
  readonly stdout: string;
  readonly stderr: string;
}

export function mergedEnv(env: Environment | undefined): NodeJS.ProcessEnv | undefined {
  if (env === undefined) {
    return undefined;
  }
  return { ...process.env, ...env };
}

export function runProcess(argv: readonly string[], options: ProcessOptions): Promise<ProcessResult> {
  const command = argv[0];
  if (command === undefined) {
    return Promise.reject(new Error("argv must not be empty"));
  }

  return new Promise((resolve, reject) => {
    const args = argv.slice(1);
    const child: ChildProcessWithoutNullStreams = spawn(command, args, {
      cwd: options.cwd,
      env: mergedEnv(options.env),
      stdio: "pipe",
    });
    child.stdin.end();

    let stdout = "";
    let stderr = "";

    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk: string) => {
      stderr += chunk;
    });
    child.on("error", reject);
    child.on("close", (code: number | null, signal: NodeJS.Signals | null) => {
      resolve({
        code: processReturnCode(code, signal),
        signal: signal ?? undefined,
        stdout,
        stderr,
      });
    });
  });
}

function processReturnCode(code: number | null, signal: NodeJS.Signals | null): number {
  if (code !== null) {
    return code;
  }
  if (signal !== null) {
    const signalNumber = constants.signals[signal];
    if (typeof signalNumber === "number") {
      return -signalNumber;
    }
  }
  return 1;
}
