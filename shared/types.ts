// Domain types shared by the API server and the web client.

export const LEAD_STATUSES = [
  'New',
  'Contacted',
  'Interested',
  'Negotiating',
  'Won',
  'Follow Up Later',
  'Not Interested',
  'Lost',
] as const;
export type LeadStatus = (typeof LEAD_STATUSES)[number];

export const STATUS_DESCRIPTIONS: Record<LeadStatus, string> = {
  New: "Haven't called them yet",
  Contacted: 'Spoke to them, no clear interest yet',
  Interested: 'Interested in getting a website',
  Negotiating: 'Discussing price / details',
  Won: 'Agreed to work with me',
  'Follow Up Later': 'Not ready now, maybe later',
  'Not Interested': 'Explicitly declined',
  Lost: 'Opportunity no longer active',
};

/** Statuses that end the sales conversation — open follow-ups are closed. */
export const CLOSED_STATUSES: LeadStatus[] = ['Not Interested', 'Lost'];

export const PROJECT_STATUSES = [
  'Not Started',
  'Gathering Information',
  'Designing',
  'Development',
  'Client Review',
  'Revisions',
  'Ready to Launch',
  'Live',
  'Completed',
] as const;
export type ProjectStatus = (typeof PROJECT_STATUSES)[number];

export const INTERACTION_TYPES = ['Phone Call', 'Email', 'SMS', 'Meeting', 'Other'] as const;
export type InteractionType = (typeof INTERACTION_TYPES)[number];

export const INTERACTION_RESULTS = [
  'Spoke',
  'No answer',
  'Left voicemail',
  'Interested',
  'Not interested',
  'Call back later',
  'Sent info',
  'Meeting booked',
  'Other',
] as const;

export interface Lead {
  id: number;
  business_name: string;
  contact_name: string;
  phone: string;
  email: string;
  category: string;
  location: string;
  has_website: boolean;
  existing_website: string;
  preview_url: string;
  live_url: string;
  status: LeadStatus;
  potential_value: number | null;
  notes: string;
  extra_info: string;
  is_demo: boolean;
  /** Local wall-clock datetime "YYYY-MM-DDTHH:mm" in the configured time zone. */
  created_at: string;
  last_contacted_at: string | null;
  /** Local date "YYYY-MM-DD". Mirrors the open follow-up reminder. */
  next_follow_up_at: string | null;
  follow_up_notes: string;
  updated_at: string;
}

/** Lead enriched with its project summary, as returned by list endpoints. */
export interface LeadWithProject extends Lead {
  project: ProjectSummary | null;
}

export interface ProjectSummary {
  id: number;
  status: ProjectStatus;
  deadline: string | null;
}

export interface Interaction {
  id: number;
  lead_id: number;
  type: InteractionType;
  date: string;
  notes: string;
  result: string;
  created_at: string;
}

export interface Project {
  id: number;
  lead_id: number;
  name: string;
  status: ProjectStatus;
  start_date: string | null;
  deadline: string | null;
  price: number | null;
  amount_paid: number | null;
  notes: string;
  created_at: string;
  updated_at: string;
}

export interface ProjectWithLead extends Project {
  business_name: string;
  contact_name: string;
  phone: string;
  preview_url: string;
  live_url: string;
  lead_status: LeadStatus;
}

export interface Reminder {
  id: number;
  lead_id: number;
  due_date: string;
  type: string;
  completed: boolean;
  completed_at: string | null;
  notes: string;
  created_at: string;
}

export interface Activity {
  id: number;
  lead_id: number;
  at: string;
  kind: string;
  text: string;
}

export interface LeadDetail {
  lead: Lead;
  project: Project | null;
  interactions: Interaction[];
  reminders: Reminder[];
  activities: Activity[];
}

export interface Settings {
  defaultFollowUpDays: number;
  noAnswerRetryDays: number;
  skipNonWorkingDays: boolean;
  /** 0 = Sunday … 6 = Saturday */
  workingDays: number[];
  workStart: string;
  workEnd: string;
  timeZone: string;
  currency: string;
  phoneCountry: string;
  upcomingWindowDays: number;
  theme: 'system' | 'light' | 'dark';
  notifications: {
    browser: boolean;
    overdue: boolean;
    today: boolean;
    upcoming: boolean;
    deadlines: boolean;
    onlyWorkingHours: boolean;
  };
}

export const DEFAULT_SETTINGS: Settings = {
  defaultFollowUpDays: 7,
  noAnswerRetryDays: 1,
  skipNonWorkingDays: true,
  workingDays: [1, 2, 3, 4, 5],
  workStart: '09:00',
  workEnd: '18:00',
  timeZone: 'UTC',
  currency: 'USD',
  phoneCountry: 'US',
  upcomingWindowDays: 7,
  theme: 'system',
  notifications: {
    browser: false,
    overdue: true,
    today: true,
    upcoming: false,
    deadlines: true,
    onlyWorkingHours: true,
  },
};

export const QUICK_ACTIONS = [
  'called',
  'no_answer',
  'interested',
  'not_interested',
  'follow_up_later',
  'won',
  'note',
] as const;
export type QuickAction = (typeof QUICK_ACTIONS)[number];

export interface QuickActionInput {
  action: QuickAction;
  note?: string;
  /** Explicit follow-up date; overrides followUpDays. */
  followUpDate?: string | null;
  /** Days from today; defaults to the configured period. */
  followUpDays?: number;
  /** When true, no follow-up is scheduled (e.g. "Interested — no follow-up"). */
  skipFollowUp?: boolean;
}
