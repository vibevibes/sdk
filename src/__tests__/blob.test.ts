import { describe, it, expect } from "vitest";
import type { ToolCtx } from "../types";

// ─── Blob operations on ToolCtx ───────────────────────────────────────────────

describe("blob operations on ToolCtx", () => {
  /** Create a mock ToolCtx with in-memory blob store. */
  function createMockCtx(
    state: Record<string, any> = {},
  ): ToolCtx & { _blobStore: Map<string, ArrayBuffer> } {
    const blobStore = new Map<string, ArrayBuffer>();

    return {
      roomId: "room-1",
      actorId: "user-1",
      state,
      setState: () => {},
      timestamp: Date.now(),
      memory: {},
      setMemory: () => {},
      roomConfig: {},
      _blobStore: blobStore,
      setBlob: (key: string, data: ArrayBuffer) => {
        blobStore.set(key, data);
        return key;
      },
      getBlob: (key: string) => {
        return blobStore.get(key);
      },
    };
  }

  it("setBlob stores data and returns key", () => {
    const ctx = createMockCtx();
    const data = new ArrayBuffer(8);
    new Uint8Array(data).set([1, 2, 3, 4, 5, 6, 7, 8]);

    const key = ctx.setBlob!("canvas-pixels", data);
    expect(key).toBe("canvas-pixels");
  });

  it("getBlob retrieves stored data", () => {
    const ctx = createMockCtx();
    const original = new ArrayBuffer(4);
    new Uint8Array(original).set([255, 128, 64, 0]);

    ctx.setBlob!("image-data", original);
    const retrieved = ctx.getBlob!("image-data");

    expect(retrieved).toBeDefined();
    expect(new Uint8Array(retrieved!)).toEqual(new Uint8Array([255, 128, 64, 0]));
  });

  it("getBlob returns undefined for non-existent key", () => {
    const ctx = createMockCtx();
    const result = ctx.getBlob!("nonexistent");
    expect(result).toBeUndefined();
  });

  it("setBlob overwrites existing blob", () => {
    const ctx = createMockCtx();

    const first = new ArrayBuffer(2);
    new Uint8Array(first).set([1, 2]);
    ctx.setBlob!("data", first);

    const second = new ArrayBuffer(3);
    new Uint8Array(second).set([3, 4, 5]);
    ctx.setBlob!("data", second);

    const retrieved = ctx.getBlob!("data");
    expect(retrieved!.byteLength).toBe(3);
    expect(new Uint8Array(retrieved!)).toEqual(new Uint8Array([3, 4, 5]));
  });

  it("multiple blobs with different keys are independent", () => {
    const ctx = createMockCtx();

    const a = new ArrayBuffer(1);
    new Uint8Array(a).set([10]);
    ctx.setBlob!("blob-a", a);

    const b = new ArrayBuffer(1);
    new Uint8Array(b).set([20]);
    ctx.setBlob!("blob-b", b);

    expect(new Uint8Array(ctx.getBlob!("blob-a")!)).toEqual(new Uint8Array([10]));
    expect(new Uint8Array(ctx.getBlob!("blob-b")!)).toEqual(new Uint8Array([20]));
  });

  it("handles empty ArrayBuffer", () => {
    const ctx = createMockCtx();
    const empty = new ArrayBuffer(0);
    ctx.setBlob!("empty", empty);

    const retrieved = ctx.getBlob!("empty");
    expect(retrieved).toBeDefined();
    expect(retrieved!.byteLength).toBe(0);
  });

  it("handles large ArrayBuffer", () => {
    const ctx = createMockCtx();
    const size = 1024 * 1024; // 1MB
    const large = new ArrayBuffer(size);
    new Uint8Array(large).fill(42);

    ctx.setBlob!("large", large);
    const retrieved = ctx.getBlob!("large");
    expect(retrieved!.byteLength).toBe(size);
    expect(new Uint8Array(retrieved!)[0]).toBe(42);
    expect(new Uint8Array(retrieved!)[size - 1]).toBe(42);
  });
});

// ─── Blob key in shared state ─────────────────────────────────────────────────

describe("blob key in shared state pattern", () => {
  it("tool handler stores blob and references key in state", () => {
    const blobStore = new Map<string, ArrayBuffer>();
    let capturedState: Record<string, any> = {};

    const ctx: ToolCtx = {
      roomId: "room-1",
      actorId: "user-1",
      state: {},
      setState: (s) => { capturedState = s; },
      timestamp: Date.now(),
      memory: {},
      setMemory: () => {},
      roomConfig: {},
      setBlob: (key, data) => { blobStore.set(key, data); return key; },
      getBlob: (key) => blobStore.get(key),
    };

    // Simulate a tool handler that generates pixel data
    const pixelData = new ArrayBuffer(100);
    new Uint8Array(pixelData).fill(128);
    const blobKey = ctx.setBlob!("canvas-v1", pixelData);
    ctx.setState({ ...ctx.state, canvasBlobKey: blobKey });

    expect(capturedState.canvasBlobKey).toBe("canvas-v1");
    expect(blobStore.get("canvas-v1")).toBeDefined();
    expect(blobStore.get("canvas-v1")!.byteLength).toBe(100);
  });
});
