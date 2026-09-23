import type {
  Interaction,
  LeadDetail,
  LeadWithProject,
  Project,
  ProjectWithLead,
  QuickActionInput,
  Reminder,
  Settings,
} from '../../shared/types';

export class ApiError extends Error {
  constructor(
    message: string,
    public field?: string,
  ) {
    super(message);
  }
}

async function req<T>(method: string, url: string, body?: unknown): Promise<T> {
  const res = await fetch(`/api${url}`, {
    method,
    headers: body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  if (res.status === 204) return undefined as T;
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(data.error ?? `Request failed (${res.status})`, data.field);
  return data as T;
}

export type ReminderRow = Reminder & {
  business_name: string;
  phone: string;
  status: LeadWithProject['status'];
  contact_name: string;
  last_contacted_at: string | null;
};
export type InteractionLite = Pick<Interaction, 'id' | 'lead_id' | 'type' | 'date' | 'result'>;

export const api = {
  settings: () => req<Settings>('GET', '/settings'),
  saveSettings: (s: Partial<Settings>) => req<Settings>('PUT', '/settings', s),

  leads: () => req<LeadWithProject[]>('GET', '/leads'),
  lead: (id: number) => req<LeadDetail>('GET', `/leads/${id}`),
  createLead: (body: object) => req<LeadDetail>('POST', '/leads', body),
  updateLead: (id: number, body: object) => req<LeadDetail>('PATCH', `/leads/${id}`, body),
  deleteLead: (id: number) => req<void>('DELETE', `/leads/${id}`),
  action: (id: number, body: QuickActionInput) => req<LeadDetail>('POST', `/leads/${id}/actions`, body),

  interactions: () => req<InteractionLite[]>('GET', '/interactions'),
  addInteraction: (leadId: number, body: object) => req<LeadDetail>('POST', `/leads/${leadId}/interactions`, body),
  updateInteraction: (id: number, body: object) => req<LeadDetail>('PATCH', `/interactions/${id}`, body),
  deleteInteraction: (id: number) => req<LeadDetail>('DELETE', `/interactions/${id}`),

  projects: () => req<ProjectWithLead[]>('GET', '/projects'),
  createProject: (leadId: number, body: object) => req<Project>('POST', `/leads/${leadId}/project`, body),
  updateProject: (id: number, body: object) => req<Project>('PATCH', `/projects/${id}`, body),
  deleteProject: (id: number) => req<void>('DELETE', `/projects/${id}`),

  reminders: () => req<ReminderRow[]>('GET', '/reminders'),
  completeReminder: (id: number) => req<LeadDetail>('POST', `/reminders/${id}/complete`),
  snoozeReminder: (id: number, body: { days?: number; date?: string }) =>
    req<LeadDetail>('POST', `/reminders/${id}/snooze`, body),

  everInterested: () => req<number[]>('GET', '/analytics/ever-interested'),
  exportAll: () => req<object>('GET', '/export'),
  loadDemo: () => req<object>('POST', '/demo'),
  deleteDemo: () => req<{ deleted: number }>('DELETE', '/demo'),
};
