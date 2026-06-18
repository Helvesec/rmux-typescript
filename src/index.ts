export { CommandRun } from "./command.js";
export {
  ControlExit,
  ControlExtendedOutput,
  ControlMalformed,
  ControlModeStreamEndedError,
  ControlModeClient,
  ControlNotification,
  ControlOutput,
  type ControlEvent,
} from "./control.js";
export { RmuxCommandError, RmuxCompatibilityError } from "./errors.js";
export { TextExpectation, TextMatch } from "./expectations.js";
export { Pane, Session, Window } from "./handles/index.js";
export { PaneExitState } from "./lifecycle.js";
export { LocatorExpectation, TextLocator } from "./locators.js";
export { PaneSet, PaneSetExpectation, PaneSetOutcome } from "./pane-set.js";
export { Rmux, Rmux as RMUX, Rmux as Server, BINARY_CONTRACT_VERSION } from "./rmux.js";
export { RmuxBuilder } from "./builder.js";
export { PaneSnapshot } from "./snapshot.js";
export { PaneLineStream, PaneOutputChunk, PaneOutputStream, PaneRenderStream } from "./streams.js";
export { RmuxTraceBuilder, TraceSession, type TraceEvent } from "./trace.js";
export type {
  CaptureOptions,
  CommandArgument,
  CommandOptions,
  Duration,
  EnsureSessionOptions,
  Environment,
  JsonObject,
  JsonValue,
  NewWindowOptions,
  ResizeOptions,
  RespawnOptions,
  RmuxOptions,
  SplitOptions,
} from "./types.js";

export const version = "0.6.5";
