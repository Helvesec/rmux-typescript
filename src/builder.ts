import { Rmux } from "./rmux.js";
import type { Environment } from "./types.js";

export class RmuxBuilder {
  #binary = "rmux";
  #socketPath: string | undefined;
  #socketName: string | undefined;
  #checkCompatibility = true;
  #env: Environment | undefined;
  #cwd: string | undefined;

  binary(value: string): this {
    this.#binary = value;
    return this;
  }

  socketPath(value: string): this {
    this.#socketPath = value;
    this.#socketName = undefined;
    return this;
  }

  socketName(value: string): this {
    this.#socketName = value;
    this.#socketPath = undefined;
    return this;
  }

  checkCompatibility(enabled: boolean): this {
    this.#checkCompatibility = enabled;
    return this;
  }

  env(value: Environment | undefined): this {
    this.#env = value === undefined ? undefined : { ...value };
    return this;
  }

  cwd(value: string | undefined): this {
    this.#cwd = value;
    return this;
  }

  async connectOrStart(): Promise<Rmux> {
    const rmux = new Rmux({
      binary: this.#binary,
      socketPath: this.#socketPath,
      socketName: this.#socketName,
      checkCompatibility: this.#checkCompatibility,
      env: this.#env,
      cwd: this.#cwd,
    });

    await rmux.startServer();
    if (this.#checkCompatibility) {
      await rmux.capabilities();
    }
    return rmux;
  }
}
