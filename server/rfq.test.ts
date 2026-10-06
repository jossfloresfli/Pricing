import { strict as assert } from "node:assert";
import { test } from "node:test";
import { insertPricingRequestSchema } from "../shared/schema";
import { buildQuoteTiming } from "./quoteTiming";
import { apiRequest, queryClient } from "../client/src/lib/queryClient";

const base = {
  cliente: "RFQ regression",
  tipoEquipo: "Caja seca",
  rutas: "[]",
  salesRep: "Test",
};

test("new quotations preserve RFQ true/false and default omitted classification to false", () => {
  for (const esRFQ of [true, false]) {
    assert.equal(insertPricingRequestSchema.parse({ ...base, esRFQ }).esRFQ, esRFQ);
  }
  assert.equal(insertPricingRequestSchema.parse(base).esRFQ, false);
  for (const esRFQ of [null, "true", "false", 1, 0]) {
    assert.equal(insertPricingRequestSchema.safeParse({ ...base, esRFQ }).success, false);
  }
});

test("RFQ counts before sending but only contributes timing after a valid send date", () => {
  const quote = {
    ...insertPricingRequestSchema.parse({ ...base, esRFQ: true }),
    createdAt: "2026-10-02T18:00:00-06:00",
    fechaEnvio: null,
  };
  assert.equal(buildQuoteTiming([quote]).rfq.total, 1);
  assert.equal(buildQuoteTiming([quote]).rfq.averageHours, null);
  const sent = { ...quote, fechaEnvio: "2026-10-05T09:00:00-06:00" };
  assert.equal(buildQuoteTiming([sent]).rfq.averageHours, 15);
  assert.equal(buildQuoteTiming([sent]).nonRfq.total, 0);
});

test("successful quote mutations refresh all statistics filters; failed saves do not", async (t) => {
  const keys: unknown[] = [];
  t.mock.method(queryClient, "invalidateQueries", async (options: { queryKey: unknown[] }) => {
    keys.push(options.queryKey);
  });
  const fetchMock = t.mock.method(globalThis, "fetch", async () => new Response("{}", { status: 200 }));
  for (const method of ["POST", "PATCH", "DELETE"]) {
    keys.length = 0;
    await apiRequest(method, "/api/pricing-requests/test", { esRFQ: true });
    assert.deepEqual(keys, [["/api/admin/stats"], ["/api/dashboard/stats"]]);
  }
  keys.length = 0;
  await apiRequest("GET", "/api/pricing-requests");
  assert.deepEqual(keys, []);
  fetchMock.mock.mockImplementation(async () => new Response("Invalid RFQ", { status: 400 }));
  await assert.rejects(apiRequest("POST", "/api/pricing-requests", { esRFQ: null }));
  assert.deepEqual(keys, []);
});