import { appendFile, mkdir } from "node:fs/promises";
import path from "node:path";
import type { RunEvent } from "../protocol.js";

export interface Trace {
  write(event: RunEvent): Promise<void>;
}

export class JsonlTrace implements Trace {
  constructor(private readonly filePath: string) {}

  async write(event: RunEvent): Promise<void> {
    await mkdir(path.dirname(this.filePath), { recursive: true });
    await appendFile(
      this.filePath,
      `${JSON.stringify({ timestamp: new Date().toISOString(), ...event })}\n`,
      "utf8",
    );
  }
}
