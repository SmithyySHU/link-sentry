import { computeNextScheduledAt } from "./siteSchedule";

const now = new Date();
const daily = computeNextScheduledAt(
  { frequency: "daily", timeUtc: "02:00" },
  now,
);
const weekly = computeNextScheduledAt(
  { frequency: "weekly", timeUtc: "02:00", dayOfWeek: 1 },
  now,
);

console.log(`Now (UTC): ${now.toISOString()}`);
console.log(`Next daily @02:00: ${daily.toISOString()}`);
console.log(`Next weekly Mon @02:00: ${weekly.toISOString()}`);
