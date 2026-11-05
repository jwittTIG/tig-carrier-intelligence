import { describe, expect, it } from "vitest";
import { assertPropertyCasualtyLine, excludedLineReason } from "@/lib/taxonomy/scope";

describe("P&C scope guard", () => {
  it.each(["Group Life", "Health", "Employee Benefits", "Short-Term Disability", "Long-Term Care", "LTC", "Dental", "Medical Plans"])(
    "rejects %s",
    (name) => expect(excludedLineReason(name)).not.toBeNull(),
  );
  it.each(["General Liability", "Workers' Compensation", "Medical Professional Liability", "Cyber", "Contract Surety", "Builders Risk"])(
    "accepts %s",
    (name) => expect(() => assertPropertyCasualtyLine(name)).not.toThrow(),
  );
});
