import { z } from 'zod';
import {
  INTERACTION_TYPES,
  LEAD_STATUSES,
  PROJECT_STATUSES,
  QUICK_ACTIONS,
} from '../shared/types.ts';
import { isValidDate } from '../shared/dates.ts';
import { isValidEmail, isValidUrl } from '../shared/format.ts';

const text = (max = 5000) => z.string().max(max);
const url = z.string().max(2000).refine(isValidUrl, 'Invalid URL');
const date = z.string().refine(isValidDate, 'Invalid date (YYYY-MM-DD)');
const dateOrTime = z.string().refine((v) => isValidDate(v.slice(0, 10)) && (v.length === 10 || /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(v)), 'Invalid date');
const money = z.number().finite().min(0).max(1e9).nullable();
const days = z.number().int().min(0).max(3650);

const leadFields = {
  business_name: z.string().trim().min(1, 'Business name is required').max(200),
  contact_name: text(200),
  phone: z.string().trim().max(50),
  email: z.string().max(200).refine(isValidEmail, 'Invalid email'),
  category: text(100),
  location: text(200),
  has_website: z.boolean(),
  existing_website: url,
  preview_url: url,
  live_url: url,
  status: z.enum(LEAD_STATUSES),
  potential_value: money,
  notes: text(),
  extra_info: text(),
  last_contacted_at: dateOrTime.nullable(),
  next_follow_up_at: z.union([date, z.literal('')]).nullable(),
  follow_up_days: days.nullable(),
  follow_up_notes: text(1000),
  project_status: z.enum(PROJECT_STATUSES).nullable(),
  project_notes: text(),
};

export const leadCreateSchema = z
  .object(leadFields)
  .partial()
  .required({ business_name: true, phone: true })
  .refine((v) => v.phone.replace(/\D/g, '').length >= 5, { message: 'Phone number is required', path: ['phone'] });

export const leadUpdateSchema = z
  .object(leadFields)
  .partial()
  .refine((v) => v.phone === undefined || v.phone.replace(/\D/g, '').length >= 5, {
    message: 'Phone number is required',
    path: ['phone'],
  });

export const quickActionSchema = z.object({
  action: z.enum(QUICK_ACTIONS),
  note: text(5000).optional(),
  followUpDate: date.nullable().optional(),
  followUpDays: days.optional(),
  skipFollowUp: z.boolean().optional(),
});

export const interactionSchema = z.object({
  type: z.enum(INTERACTION_TYPES),
  date: dateOrTime.optional(),
  notes: text().optional(),
  result: text(100).optional(),
  status: z.enum(LEAD_STATUSES).optional(),
  followUpDate: date.nullable().optional(),
  followUpDays: days.nullable().optional(),
  skipFollowUp: z.boolean().optional(),
});

export const projectSchema = z
  .object({
    name: text(200),
    status: z.enum(PROJECT_STATUSES),
    start_date: date.nullable(),
    deadline: date.nullable(),
    price: money,
    amount_paid: money,
    notes: text(),
    preview_url: url,
    live_url: url,
  })
  .partial();

export const snoozeSchema = z
  .object({ days: z.number().int().min(1).max(3650).optional(), date: date.optional() })
  .refine((v) => v.days || v.date, 'Provide days or date');

export const settingsSchema = z
  .object({
    defaultFollowUpDays: z.number().int().min(1).max(365),
    noAnswerRetryDays: z.number().int().min(0).max(365),
    skipNonWorkingDays: z.boolean(),
    workingDays: z.array(z.number().int().min(0).max(6)).max(7),
    workStart: z.string().regex(/^\d{2}:\d{2}$/),
    workEnd: z.string().regex(/^\d{2}:\d{2}$/),
    timeZone: z.string().refine((tz) => {
      try {
        new Intl.DateTimeFormat('en', { timeZone: tz });
        return true;
      } catch {
        return false;
      }
    }, 'Unknown time zone'),
    currency: z.string().regex(/^[A-Z]{3}$/),
    phoneCountry: z.string().regex(/^[A-Z]{2}$/),
    upcomingWindowDays: z.number().int().min(1).max(60),
    theme: z.enum(['system', 'light', 'dark']),
    notifications: z
      .object({
        browser: z.boolean(),
        overdue: z.boolean(),
        today: z.boolean(),
        upcoming: z.boolean(),
        deadlines: z.boolean(),
        onlyWorkingHours: z.boolean(),
      })
      .partial(),
  })
  .partial();
