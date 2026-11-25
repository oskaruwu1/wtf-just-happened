import { describe, it, expect } from "vitest";
import { RingBuffer } from "../src/core/ring-buffer.js";

describe("RingBuffer", () => {
  it("preserves content within capacity", () => {
    const buffer = new RingBuffer({ maxBytes: 1024 });
    buffer.write("Hello, World!");
    expect(buffer.getRaw()).toBe("Hello, World!");
    expect(buffer.byteLength).toBe(13);
  });

  it("evicts oldest bytes when exceeding capacity", () => {
    const buffer = new RingBuffer({ maxBytes: 10 });
    buffer.write("12345"); // 5 bytes
    expect(buffer.getRaw()).toBe("12345");
    expect(buffer.byteLength).toBe(5);

    buffer.write("67890"); // 10 bytes total
    expect(buffer.getRaw()).toBe("1234567890");
    expect(buffer.byteLength).toBe(10);

    buffer.write("ABC"); // 13 bytes -> must evict 3 bytes from front
    expect(buffer.getRaw()).toBe("4567890ABC");
    expect(buffer.byteLength).toBe(10);
  });

  it("enforces exact 64KB byte bound under large data streaming", () => {
    const MAX_64KB = 64 * 1024;
    const buffer = new RingBuffer({ maxBytes: MAX_64KB });

    // Stream 200KB of data in 1KB chunks
    const chunk = "A".repeat(1024);
    for (let i = 0; i < 200; i++) {
      buffer.write(chunk);
      expect(buffer.byteLength).toBeLessThanOrEqual(MAX_64KB);
    }

    expect(buffer.byteLength).toBe(MAX_64KB);
    expect(buffer.getRaw().length).toBe(MAX_64KB);
  });

  it("handles a single chunk larger than maxBytes by retaining only tail", () => {
    const buffer = new RingBuffer({ maxBytes: 5 });
    buffer.write("ABCDEFGHIJ"); // 10 bytes written at once
    expect(buffer.getRaw()).toBe("FGHIJ");
    expect(buffer.byteLength).toBe(5);
  });

  it("strips ANSI escape codes in getClean() while preserving in getRaw()", () => {
    const buffer = new RingBuffer({ maxBytes: 1024 });
    const coloredText = "\x1b[31m[ERROR]\x1b[0m \x1b[1;32mAll systems go\x1b[0m\n";

    buffer.write(coloredText);

    expect(buffer.getRaw()).toBe(coloredText);
    expect(buffer.getClean()).toBe("[ERROR] All systems go\n");
  });

  it("handles Buffers correctly", () => {
    const buffer = new RingBuffer({ maxBytes: 10 });
    buffer.write(Buffer.from("12345"));
    buffer.write(Buffer.from("67890AB"));

    expect(buffer.getRaw()).toBe("34567890AB");
    expect(buffer.byteLength).toBe(10);
  });
});
