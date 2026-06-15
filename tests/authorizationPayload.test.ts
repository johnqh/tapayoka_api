import { describe, it, expect } from "vitest";
import { tierAuthorizationFields } from "../src/services/authorizationPayload.ts";
import type { PricingTier } from "@sudobility/tapayoka_types";

const fixed: PricingTier = {
  type: "fixed",
  id: "f1",
  name: "Dispense",
  currencyCode: "USD",
  price: "1.25",
  signals: [
    { pinNumber: 23, duration: 5 },
    { pinNumber: 24, duration: 30 },
  ],
};

const timed: PricingTier = {
  type: "timed",
  id: "t1",
  name: "Charge",
  currencyCode: "USD",
  startPrice: "2.50",
  startDuration: 30,
  startDurationUnit: "minutes",
  marginalPrice: "0.50",
  marginalDuration: 5,
  marginalDurationUnit: "minutes",
  pinNumber: 1,
};

describe("tierAuthorizationFields", () => {
  it("returns FIXED with the tier's signals", () => {
    expect(tierAuthorizationFields(fixed)).toEqual({
      offeringType: "FIXED",
      signals: [
        { pinNumber: 23, duration: 5 },
        { pinNumber: 24, duration: 30 },
      ],
    });
  });

  it("returns TIMED without signals", () => {
    expect(tierAuthorizationFields(timed)).toEqual({ offeringType: "TIMED" });
  });

  it("returns TRIGGER for a null tier", () => {
    expect(tierAuthorizationFields(null)).toEqual({ offeringType: "TRIGGER" });
  });
});
