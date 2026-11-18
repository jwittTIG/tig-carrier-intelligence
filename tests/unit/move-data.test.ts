import { describe, expect, it } from "vitest";
import { insertOrder, orderSelfReferencing, type ForeignKey } from "../../scripts/move-data-lib";

/** The one-time move to Render (scripts/move-data.ts, 2026-11-18). */
describe("insert order", () => {
  const fks: ForeignKey[] = [
    { child: "contacts", parent: "organizations", columns: ["organizationId"], refs: ["id"] },
    { child: "organizations", parent: "users", columns: ["ownerUserId"], refs: ["id"] },
    { child: "organizations", parent: "organizations", columns: ["parentId"], refs: ["id"] },
  ];

  it("puts every table after the tables it points to", () => {
    const order = insertOrder(["contacts", "organizations", "users", "settings"], fks);
    expect(order.indexOf("users")).toBeLessThan(order.indexOf("organizations"));
    expect(order.indexOf("organizations")).toBeLessThan(order.indexOf("contacts"));
    expect(order).toHaveLength(4);
  });

  it("refuses a cycle between tables", () => {
    expect(() => insertOrder(["a", "b"], [
      { child: "a", parent: "b", columns: ["bId"], refs: ["id"] },
      { child: "b", parent: "a", columns: ["aId"], refs: ["id"] },
    ])).toThrow(/cycle/);
  });
});

describe("rows that point to their own table", () => {
  const self: ForeignKey[] = [{ child: "organizations", parent: "organizations", columns: ["parentId"], refs: ["id"] }];

  it("puts parents first", () => {
    const rows = [
      { id: "c", parentId: "b" },
      { id: "b", parentId: "a" },
      { id: "a", parentId: null },
      { id: "x", parentId: null },
    ];
    expect(orderSelfReferencing(rows, self).map((r) => r.id)).toEqual(["a", "x", "b", "c"]);
  });

  it("refuses a missing parent", () => {
    expect(() => orderSelfReferencing([{ id: "b", parentId: "missing" }], self)).toThrow(/loop|missing/);
  });
});
