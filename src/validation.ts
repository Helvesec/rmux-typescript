import type { JsonObject } from "./types.js";

export function requiredString(
  value: unknown,
  context: string,
  field: string,
): string {
  if (typeof value === "string" && value.length > 0) {
    return value;
  }
  throw new TypeError(`${context} is missing non-empty string field ${JSON.stringify(field)}`);
}

export function requiredInteger(
  value: unknown,
  context: string,
  field: string,
): number {
  if (typeof value === "number" && Number.isInteger(value)) {
    return value;
  }
  throw new TypeError(`${context} is missing integer field ${JSON.stringify(field)}`);
}

export function requiredPaneId(value: unknown, context: string): string {
  const paneId = requiredString(value, context, "pane_id");
  if (/^%[0-9]+$/.test(paneId)) {
    return paneId;
  }
  throw new TypeError(`${context} has invalid pane_id ${JSON.stringify(paneId)}`);
}

export function requiredSessionId(value: unknown, context: string): string {
  const sessionId = requiredString(value, context, "session_id");
  if (/^\$[0-9]+$/.test(sessionId)) {
    return sessionId;
  }
  throw new TypeError(`${context} has invalid session_id ${JSON.stringify(sessionId)}`);
}

export function parseRequiredInteger(value: string, context: string): number {
  if (/^-?[0-9]+$/.test(value)) {
    return Number.parseInt(value, 10);
  }
  throw new TypeError(`${context} is not an integer: ${JSON.stringify(value)}`);
}

export function parsePaneId(value: string, context: string): string {
  const paneId = value.trim();
  if (/^%[0-9]+$/.test(paneId)) {
    return paneId;
  }
  throw new TypeError(`${context} did not return a pane id: ${JSON.stringify(value)}`);
}

export function parseWindowIndex(value: string, context: string): number {
  const parsed = parseRequiredInteger(value.trim(), context);
  if (parsed < 0) {
    throw new TypeError(`${context} must be non-negative: ${JSON.stringify(value)}`);
  }
  return parsed;
}

export function isJsonObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
