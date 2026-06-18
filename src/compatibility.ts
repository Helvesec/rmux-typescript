import type { Rmux } from "./rmux.js";

export async function ensureServerCompatible(server: Rmux): Promise<void> {
  if (server.checkCompatibility) {
    await server.capabilities();
  }
}
