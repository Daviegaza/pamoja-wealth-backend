import { z } from "zod";

export const createMeetingSchema = z.object({
  chamaId: z.string().uuid(),
  title: z.string().min(2).max(255),
  description: z.string().optional(),
  date: z.string(),
  time: z.string(),
  location: z.string().min(2).max(255),
  isVirtual: z.boolean().default(false),
  agenda: z.array(z.string()).default([]),
});

export const updateMeetingSchema = z.object({
  title: z.string().min(2).max(255).optional(),
  description: z.string().optional(),
  date: z.string().optional(),
  time: z.string().optional(),
  location: z.string().min(2).max(255).optional(),
  status: z.enum(["scheduled", "ongoing", "completed", "cancelled"]).optional(),
});

export const rsvpSchema = z.object({
  status: z.enum(["attending", "declined", "tentative"]),
});

export const meetingQuerySchema = z.object({
  chamaId: z.string().uuid().optional(),
  status: z.enum(["scheduled", "ongoing", "completed", "cancelled"]).optional(),
  from: z.string().optional(),
  to: z.string().optional(),
  page: z.coerce.number().min(1).default(1),
  pageSize: z.coerce.number().min(1).max(100).default(20),
});

export const meetingMinutesSchema = z.object({
  content: z.string().min(1),
});
