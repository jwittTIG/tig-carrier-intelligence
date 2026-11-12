import { describe, expect, it } from "vitest";
import { modeOf } from "@/lib/theme";

describe("theme mode", () => {
  it("is light unless dark was chosen; anything else in the cookie means light", () => {
    expect(modeOf("dark")).toBe("dark");
    expect(modeOf("light")).toBe("light");
    expect(modeOf(undefined)).toBe("light");
    expect(modeOf("purple")).toBe("light");
  });
});
