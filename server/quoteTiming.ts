type TimingRequest = {
  esRFQ?: boolean | null;
  division?: string | null;
  createdAt: Date | string | null;
  fechaEnvio: Date | string | null;
};

// Mexico City uses UTC-6 year-round for the dates in this application (2023+).
// Shift to local wall time, then count complete weekdays plus partial endpoints.
export function weekdayHours(start: Date | string, end: Date | string): number {
  const shift = 6 * 3_600_000;
  let cursor = new Date(start).getTime() - shift;
  const finish = new Date(end).getTime() - shift;
  if (!Number.isFinite(cursor) || !Number.isFinite(finish) || finish < cursor) return NaN;
  const day = 24 * 3_600_000;
  const weeks = Math.floor((finish - cursor) / (7 * day));
  let elapsed = weeks * 5 * day;
  cursor += weeks * 7 * day;
  while (cursor < finish) {
    const next = Math.min((Math.floor(cursor / day) + 1) * day, finish);
    const weekday = new Date(cursor).getUTCDay();
    if (weekday !== 0 && weekday !== 6) elapsed += next - cursor;
    cursor = next;
  }
  return elapsed / 3_600_000;
}

export function summarizeQuoteTiming(requests: TimingRequest[]) {
  const hours: number[] = [];
  let missingDates = 0;
  let invalidDates = 0;
  for (const request of requests) {
    if (!request.createdAt || !request.fechaEnvio) {
      missingDates++;
      continue;
    }
    const elapsed = weekdayHours(request.createdAt, request.fechaEnvio);
    if (!Number.isFinite(elapsed) || elapsed < 0) {
      invalidDates++;
      continue;
    }
    hours.push(elapsed);
  }
  hours.sort((a, b) => a - b);
  const middle = Math.floor(hours.length / 2);
  return {
    total: requests.length,
    valid: hours.length,
    missingDates,
    invalidDates,
    averageHours: hours.length ? hours.reduce((a, b) => a + b, 0) / hours.length : null,
    medianHours: hours.length
      ? hours.length % 2 ? hours[middle] : (hours[middle - 1] + hours[middle]) / 2
      : null,
  };
}

// Historical estimate only: creation is not a verified "por_revisar" transition.
// Keep National distinct from Domestic, and Port Freight distinct from Maritime.
export function buildQuoteTiming(allRequests: TimingRequest[], type: "all" | "rfq" | "non-rfq" = "all") {
  // Legacy nulls are grouped with non-RFQ, but do not prove the user's selection:
  // older clients omitted the field when submitting.
  const requests = allRequests.filter(r => type === "all" ||
    (type === "rfq" ? r.esRFQ === true : r.esRFQ !== true));
  const division = (name: string) =>
    requests.filter(r => r.division?.trim().toLowerCase() === name);
  return {
    general: summarizeQuoteTiming(requests),
    rfq: summarizeQuoteTiming(allRequests.filter(r => r.esRFQ === true)),
    nonRfq: summarizeQuoteTiming(allRequests.filter(r => r.esRFQ !== true)),
    crossborder: summarizeQuoteTiming(division("crossborder")),
    national: summarizeQuoteTiming(division("national")),
    portFreight: summarizeQuoteTiming(division("port freight")),
  };
}