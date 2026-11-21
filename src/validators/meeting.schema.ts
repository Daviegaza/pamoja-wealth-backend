import { z } from "zod";
import { dateOnly } from "./common.js";

export const createMeetingSchema = z
  .object({
    title: z.string().trim().min(2).max(200),
    description: z.string().trim().max(2000).optional(),
    date: dateOnly,
    time: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Use HH:MM (24h)"),
    location: z.string().trim().min(1).max(300),
    isVirtual: z.boolean().default(false),
    agenda: z.array(z.string().trim().min(1).max(300)).max(50).default([]),
  })
  .strict();

export const updateMeetingSchema = createMeetingSchema
  .partial()
  .extend({ status: z.enum(["scheduled", "ongoing", "completed", "cancelled"]).optional() })
  .strict();

export const minutesSchema = z.object({ minutes: z.string().trim().min(1).max(50_000) }).strict();

export const rsvpSchema = z.object({ status: z.enum(["attending", "declined", "tentative"]) }).strict();
