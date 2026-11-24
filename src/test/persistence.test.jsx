import { act, renderHook, cleanup } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { usePersistentState } from "../hooks/usePersistentState.js";

beforeEach(() => window.localStorage.clear());
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("Persistent workflow state", () => {
  it("restores saved state before writing and persists edits", () => {
    window.localStorage.setItem("oceanguard:v1:activeTab", "5");
    const { result } = renderHook(() => usePersistentState("activeTab", 1));
    expect(result.current[0]).toBe(5);
    act(() => result.current[1](6));
    expect(window.localStorage.getItem("oceanguard:v1:activeTab")).toBe("6");
  });

  it("uses the initial value when saved JSON is corrupt", () => {
    window.localStorage.setItem("oceanguard:v1:activeTab", "broken");
    const { result } = renderHook(() => usePersistentState("activeTab", 1));
    expect(result.current[0]).toBe(1);
  });

  it("continues in memory when browser storage is blocked", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("Blocked");
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("Blocked");
    });
    const { result } = renderHook(() => usePersistentState("activeTab", 1));
    act(() => result.current[1](2));
    expect(result.current[0]).toBe(2);
  });

  it("switches storage keys without overwriting the destination with the old value", () => {
    window.localStorage.setItem("oceanguard:v1:first", "4");
    window.localStorage.setItem("oceanguard:v1:second", "6");
    const { result, rerender } = renderHook(({ storageKey }) => usePersistentState(storageKey, 1), {
      initialProps: { storageKey: "first" },
    });
    rerender({ storageKey: "second" });
    expect(result.current[0]).toBe(6);
    expect(window.localStorage.getItem("oceanguard:v1:second")).toBe("6");
  });
});
