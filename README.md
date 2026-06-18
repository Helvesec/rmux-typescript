# @rmux/sdk

`@rmux/sdk` is the TypeScript SDK for [RMUX](https://github.com/Helvesec/rmux).
Its public handles follow the same vocabulary as the Rust and Python SDKs:
`RMUX`, `Session`, `Window`, and `Pane`.

[Examples available](https://rmux.io/docs/examples/#/quickstart)

[npm package](https://www.npmjs.com/package/@rmux/sdk)

## Installation

```bash
npm install @rmux/sdk
```

`@rmux/sdk` targets RMUX 0.6.x and uses the `rmux` executable. Install the RMUX
binary separately and keep it on `PATH`, or pass a specific binary with
`RMUX.builder().binary(...)`.

```ts
import { RMUX } from "@rmux/sdk";

const rmux = new RMUX();
for (const session of await rmux.listSessions()) {
  console.log(session.session_name);
}
```

`Rmux` and `Server` remain available as aliases for existing code.

## Endpoint Selection

```ts
new RMUX();                               // default rmux endpoint
new RMUX({ socketPath: "/tmp/rmux" });    // passes -S /tmp/rmux
new RMUX({ socketName: "demo" });         // passes -L demo
RMUX.builder().socketName("demo").connectOrStart();
```

## Common Operations

```ts
const session = await rmux.ensureSession("demo");
const pane = session.pane(0, 0);
await pane.sendText("echo hello\n");
await pane.expectVisibleText().toContain("hello").timeout(5);
const text = await pane.captureText();
```

For raw commands:

```ts
const run = await rmux.cmd("rename-window", "-t", "demo:0", "logs");
if (run.returnCode !== 0) {
  throw new Error(run.stderr);
}
```
