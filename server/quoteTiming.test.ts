import { strict as assert } from "node:assert";
import { test } from "node:test";
import { buildQuoteTiming, summarizeQuoteTiming, weekdayHours } from "./quoteTiming";

const quote = (hours: number, division = "National") => ({
  createdAt: new Date("2026-09-01T00:00:00Z"),
  fechaEnvio: new Date(Date.parse("2026-09-01T00:00:00Z") + hours * 3_600_000),
  division,
});

test("weekends excluded in Mexico City; weekday nights count", () => {
  assert.equal(weekdayHours("2026-10-02T18:00:00-06:00", "2026-10-05T09:00:00-06:00"), 15);
  assert.equal(weekdayHours("2026-10-03T02:00:00-06:00", "2026-10-04T22:00:00-06:00"), 0);
  assert.equal(weekdayHours("2026-10-05T18:30:00-06:00", "2026-10-06T09:00:00-06:00"), 14.5);
  assert.equal(weekdayHours("2026-10-02T18:00:00-06:00", "2026-10-16T18:00:00-06:00"), 240);
  assert.equal(weekdayHours("2026-10-03T05:00:00Z", "2026-10-03T07:00:00Z"), 1);
  assert.ok(Number.isNaN(weekdayHours("2026-10-04", "2026-10-03")));
});

test("RFQ filtering applies to all summaries including coverage and exclusions", () => {
  const requests = [
    { ...quote(4, "National"), esRFQ: true },
    { ...quote(8, "National"), esRFQ: false },
    { ...quote(12, "Crossborder"), esRFQ: null },
    { ...quote(16, "Port Freight"), esRFQ: true },
    { ...quote(0), fechaEnvio: null, esRFQ: true },
  ];
  assert.equal(buildQuoteTiming(requests).general.total, 5);
  const rfq = buildQuoteTiming(requests, "rfq");
  assert.equal(rfq.general.total, 3);
  assert.equal(rfq.general.averageHours, 10);
  assert.equal(rfq.general.missingDates, 1);
  assert.equal(rfq.national.averageHours, 4);
  assert.equal(rfq.crossborder.valid, 0);
  assert.equal(rfq.portFreight.averageHours, 16);
  const standard = buildQuoteTiming(requests, "non-rfq");
  assert.equal(standard.general.total, 2);
  assert.equal(standard.national.averageHours, 8);
  assert.equal(standard.crossborder.averageHours, 12);
  assert.equal(standard.portFreight.averageHours, null);
  for (const type of ["all", "rfq", "non-rfq"] as const) {
    const comparison = buildQuoteTiming(requests, type);
    assert.equal(comparison.rfq.total, 3);
    assert.equal(comparison.rfq.averageHours, 10);
    assert.equal(comparison.nonRfq.total, 2);
    assert.equal(comparison.nonRfq.averageHours, 10);
  }
});

test("average and median include zero, exclude invalid and missing timestamps", () => {
  const result = summarizeQuoteTiming([
    quote(0), quote(2), quote(8), quote(24), quote(-2),
    { ...quote(2), fechaEnvio: null },
    { ...quote(2), createdAt: "invalid" },
  ]);
  assert.deepEqual(result, {
    total: 7, valid: 4, missingDates: 1, invalidDates: 2,
    averageHours: 8.5, medianHours: 5,
  });
});

test("empty groups are null, not misleading zero durations", () => {
  assert.equal(summarizeQuoteTiming([]).averageHours, null);
  assert.equal(summarizeQuoteTiming([]).medianHours, null);
  assert.equal(summarizeQuoteTiming([quote(0)]).medianHours, 0);
  assert.equal(summarizeQuoteTiming([quote(1), quote(7), quote(2)]).medianHours, 2);
});

test("general covers all divisions; National and Port Freight are not merged with others", () => {
  const result = buildQuoteTiming([
    quote(1, "National"), quote(2, "Domestic"), quote(3, "Maritime"),
    quote(4, " port freight "), quote(5, "CROSSBORDER"),
    { ...quote(6), division: null },
  ]);
  assert.equal(result.general.valid, 6);
  assert.equal(result.national.averageHours, 1);
  assert.equal(result.portFreight.averageHours, 4);
  assert.equal(result.crossborder.averageHours, 5);
});