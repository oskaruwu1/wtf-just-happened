import stripAnsi from "strip-ansi";

export interface RingBufferOptions {
  maxBytes?: number;
}

export class RingBuffer {
  private chunks: string[] = [];
  private currentBytes = 0;
  readonly maxBytes: number;

  constructor(options?: RingBufferOptions) {
    this.maxBytes = options?.maxBytes ?? 64 * 1024; // Default 64KB
  }

  /**
   * Append a chunk of text or Buffer to the circular buffer.
   */
  write(data: string | Buffer): void {
    const text = typeof data === "string" ? data : data.toString("utf8");
    if (!text) return;

    const chunkBytes = Buffer.byteLength(text, "utf8");

    // If a single chunk is larger than maxBytes, keep only its tail
    if (chunkBytes >= this.maxBytes) {
      const buf = Buffer.from(text, "utf8");
      const tailBuf = buf.subarray(buf.length - this.maxBytes);
      this.chunks = [tailBuf.toString("utf8")];
      this.currentBytes = Buffer.byteLength(this.chunks[0], "utf8");
      return;
    }

    this.chunks.push(text);
    this.currentBytes += chunkBytes;

    // Evict chunks from head until currentBytes <= maxBytes
    while (this.chunks.length > 0 && this.currentBytes > this.maxBytes) {
      const headChunk = this.chunks[0];
      const headBytes = Buffer.byteLength(headChunk, "utf8");
      const excess = this.currentBytes - this.maxBytes;

      if (headBytes <= excess) {
        this.chunks.shift();
        this.currentBytes -= headBytes;
      } else {
        // Trim head chunk
        const headBuf = Buffer.from(headChunk, "utf8");
        const trimmedBuf = headBuf.subarray(excess);
        const trimmedStr = trimmedBuf.toString("utf8");
        this.chunks[0] = trimmedStr;
        this.currentBytes = this.currentBytes - headBytes + Buffer.byteLength(trimmedStr, "utf8");
        break;
      }
    }
  }

  /**
   * Get raw output including ANSI escape sequences.
   */
  getRaw(): string {
    return this.chunks.join("");
  }

  /**
   * Get clean output with ANSI escape sequences stripped.
   */
  getClean(): string {
    return stripAnsi(this.getRaw());
  }

  /**
   * Get the current byte length of stored content.
   */
  get byteLength(): number {
    return this.currentBytes;
  }

  /**
   * Clear the ring buffer.
   */
  clear(): void {
    this.chunks = [];
    this.currentBytes = 0;
  }
}
