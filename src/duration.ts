import { performance } from "node:perf_hooks";
import type { Duration } from "./types.js";

export function durationMilliseconds(value: Duration): number {
  const milliseconds =
    typeof value === "number"
      ? value * 1000
      : (value.milliseconds ?? 0) + (value.seconds ?? 0) * 1000;

  if (!Number.isFinite(milliseconds) || milliseconds < 0) {
    throw new RangeError("duration must be a non-negative finite value");
  }

  return milliseconds;
}

export function sleep(milliseconds: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, milliseconds);
  });
}

export function deadlineFromNow(timeout: Duration): number {
  return performance.now() + durationMilliseconds(timeout);
}

export function deadlineExpired(deadline: number): boolean {
  return performance.now() >= deadline;
}

export function remainingMilliseconds(deadline: number): number {
  return Math.max(0, deadline - performance.now());
}
