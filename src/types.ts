export type JsonValue =
  | null
  | boolean
  | number
  | string
  | JsonValue[]
  | { [key: string]: JsonValue };

export type JsonObject = { [key: string]: JsonValue };

export type Duration =
  | number
  | {
      seconds?: number;
      milliseconds?: number;
    };

export type Environment = Readonly<Record<string, string>>;

export type CommandArgument = string | number | bigint;

export interface CommandOptions {
  readonly check?: boolean;
}

export interface RmuxOptions {
  readonly binary?: string | undefined;
  readonly socketPath?: string | undefined;
  readonly socketName?: string | undefined;
  readonly checkCompatibility?: boolean | undefined;
  readonly env?: Environment | undefined;
  readonly cwd?: string | undefined;
}

export interface CaptureOptions {
  readonly start?: number | string | undefined;
  readonly end?: number | string | undefined;
  readonly escapeAnsi?: boolean | undefined;
  readonly joinWrapped?: boolean | undefined;
}

export interface NewWindowOptions {
  readonly name?: string | undefined;
  readonly detached?: boolean | undefined;
  readonly shellCommand?: string | undefined;
}

export interface EnsureSessionOptions {
  readonly detached?: boolean | undefined;
  readonly shellCommand?: string | undefined;
}

export interface ResizeOptions {
  readonly width?: number | undefined;
  readonly height?: number | undefined;
}

export interface SplitOptions {
  readonly direction?: "horizontal" | "h" | "vertical" | "v" | undefined;
  readonly size?: number | string | undefined;
  readonly shellCommand?: string | undefined;
}

export interface RespawnOptions {
  readonly kill?: boolean | undefined;
  readonly shellCommand?: string | undefined;
}
