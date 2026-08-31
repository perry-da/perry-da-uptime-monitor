import { z } from "zod";

const MIN_INTERVAL_SECONDS = 60; // ISC-26
export const FREE_TIER_MONITOR_CAP = 50; // ISC-27 — placeholder, see ISA Decisions

const base = {
  name: z.string().trim().min(1).max(200).optional(), // ISC-28: defaults to url/hostname if absent
  intervalSeconds: z.number().int().min(MIN_INTERVAL_SECONDS).default(60),
  webhookUrl: z.string().url().optional(),
};

// ISC-15, ISC-21
const httpFields = z.object({
  type: z.literal("http"),
  url: z.string().url(),
  ...base,
});

// ISC-16
const pingFields = z.object({
  type: z.literal("ping"),
  hostname: z.string().min(1).max(255),
  ...base,
});

// ISC-17
const tcpFields = z.object({
  type: z.literal("tcp"),
  hostname: z.string().min(1).max(255),
  port: z.number().int().min(1).max(65535),
  ...base,
});

// ISC-18
const keywordFields = z.object({
  type: z.literal("keyword"),
  url: z.string().url(),
  keyword: z.string().min(1),
  ...base,
});

// ISC-19
const sslFields = z.object({
  type: z.literal("ssl"),
  hostname: z.string().min(1).max(255),
  sslExpiryWarningDays: z.number().int().min(1).max(90).default(14), // ISC-42
  ...base,
});

// ISC-20: discriminated union rejects any type outside the 5 supported values.
export const createMonitorSchema = z.discriminatedUnion("type", [
  httpFields,
  pingFields,
  tcpFields,
  keywordFields,
  sslFields,
]);

export type CreateMonitorInput = z.infer<typeof createMonitorSchema>;

export function defaultNameFor(input: CreateMonitorInput): string {
  if (input.name) return input.name;
  if ("url" in input) return input.url;
  if ("hostname" in input) return input.hostname;
  return "Untitled monitor";
}
