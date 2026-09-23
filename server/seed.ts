// Fictional demo businesses (flagged is_demo) so the app is useful on first open.
// Dates are relative to "today" so the dashboard always has something to show.
import type { Db } from './db.ts';
import type { CrmService, LeadInput, ProjectInput } from './service.ts';
import { addDays } from '../shared/dates.ts';

interface DemoLead extends LeadInput {
  history?: { days: number; type?: string; result: string; notes: string }[];
  project?: ProjectInput;
}

export async function seedDemo(db: Db, svc: CrmService) {
  const today = await svc.today();
  const d = (offset: number) => addDays(today, offset);
  const dt = (offset: number, time = '10:30') => `${d(offset)}T${time}`;

  const leads: DemoLead[] = [
    {
      business_name: 'Sunrise Bakery',
      contact_name: 'Maria Lopez',
      phone: '(555) 010-1001',
      category: 'Bakery',
      location: 'Springfield',
      status: 'New',
      potential_value: 1200,
      notes: 'Found on Google Maps. Only has a Facebook page. Busy mornings — call after 2pm.',
      created_at: dt(-1, '16:10'),
      next_follow_up_at: d(0),
      follow_up_notes: 'New lead — first call',
    },
    {
      business_name: 'Harbor Auto Repair',
      contact_name: '',
      phone: '(555) 010-1002',
      category: 'Auto Repair',
      location: 'Riverside',
      has_website: true,
      existing_website: 'harbor-auto.example',
      status: 'New',
      potential_value: 1500,
      notes: 'Website looks ~2010, not mobile friendly.',
      created_at: dt(-2, '11:00'),
      next_follow_up_at: d(0),
      follow_up_notes: 'New lead — first call',
    },
    {
      business_name: "Mike's Barbershop",
      contact_name: 'Mike Turner',
      phone: '(555) 010-1003',
      email: 'mike@mikes-barbershop.example',
      category: 'Barbershop',
      location: 'Springfield',
      status: 'Contacted',
      potential_value: 900,
      notes: 'Wants online booking. Uses Instagram a lot.',
      created_at: dt(-12, '09:40'),
      last_contacted_at: dt(-7, '14:20'),
      next_follow_up_at: d(0),
      follow_up_notes: 'Follow-up after call',
      history: [
        { days: -10, result: 'No answer', notes: '' },
        { days: -7, result: 'Spoke', notes: 'Spoke with Mike. Busy with a client, asked me to call again next week.' },
      ],
    },
    {
      business_name: "John's Auto Detailing",
      contact_name: 'John Park',
      phone: '(555) 010-1004',
      category: 'Auto Detailing',
      location: 'Lakeside',
      status: 'Contacted',
      potential_value: 1100,
      notes: 'Owner seemed open but wants to see examples.',
      created_at: dt(-15),
      last_contacted_at: dt(-10, '15:05'),
      next_follow_up_at: d(-3),
      follow_up_notes: 'Send portfolio examples, then call',
      history: [{ days: -10, result: 'Spoke', notes: 'Initial call. Asked for examples of previous work.' }],
    },
    {
      business_name: 'Bella Vista Italian',
      contact_name: 'Giulia Rossi',
      phone: '(555) 010-1005',
      email: 'giulia@bellavista.example',
      category: 'Restaurant',
      location: 'Old Town',
      has_website: true,
      existing_website: 'bellavista-menu.example',
      preview_url: 'preview-bellavista.example',
      status: 'Interested',
      potential_value: 1800,
      notes: 'Wants online menu + reservations. Loved the preview I built.',
      created_at: dt(-20),
      last_contacted_at: dt(-2, '11:15'),
      next_follow_up_at: d(2),
      follow_up_notes: 'Walk through preview together',
      history: [
        { days: -16, result: 'Spoke', notes: 'Initial call. Spoke to manager.' },
        { days: -9, type: 'Email', result: 'Sent info', notes: 'Sent preview link.' },
        { days: -2, result: 'Interested', notes: 'Spoke with owner. Interested in a new website. Asked me to call again this week.' },
      ],
    },
    {
      business_name: 'ABC Construction',
      contact_name: 'Dan Brooks',
      phone: '(555) 010-1006',
      email: 'dan@abc-construction.example',
      category: 'Construction',
      location: 'Northgate',
      status: 'Negotiating',
      potential_value: 3500,
      notes: 'Needs a portfolio site with project gallery. Comparing my quote with an agency.',
      created_at: dt(-25),
      last_contacted_at: dt(-1, '10:00'),
      next_follow_up_at: d(4),
      follow_up_notes: 'Send revised quote',
      history: [
        { days: -21, result: 'Spoke', notes: 'Initial call.' },
        { days: -14, type: 'Meeting', result: 'Meeting booked', notes: 'Met on site, discussed scope.' },
        { days: -1, result: 'Spoke', notes: 'Discussed price. Wants a payment plan.' },
      ],
    },
    {
      business_name: 'Green Leaf Landscaping',
      contact_name: 'Sam Green',
      phone: '(555) 010-1007',
      category: 'Landscaping',
      location: 'Riverside',
      status: 'Follow Up Later',
      potential_value: 1400,
      notes: 'Busy season now. Said to call back next month.',
      created_at: dt(-18),
      last_contacted_at: dt(-5, '16:30'),
      next_follow_up_at: d(25),
      follow_up_notes: 'Call back after busy season',
      history: [{ days: -5, result: 'Call back later', notes: 'Too busy right now — call back next month.' }],
    },
    {
      business_name: 'Pawsome Pet Grooming',
      contact_name: 'Lisa Chen',
      phone: '(555) 010-1008',
      category: 'Pet Services',
      location: 'Lakeside',
      has_website: true,
      existing_website: 'pawsome.example',
      status: 'Not Interested',
      potential_value: 1000,
      notes: 'Happy with their current site (nephew built it).',
      created_at: dt(-14),
      last_contacted_at: dt(-13, '13:00'),
      history: [{ days: -13, result: 'Not interested', notes: 'Declined politely.' }],
    },
    {
      business_name: 'Coastal Dental Studio',
      contact_name: 'Dr. Amy Walsh',
      phone: '(555) 010-1009',
      email: 'office@coastal-dental.example',
      category: 'Dentist',
      location: 'Harbor District',
      preview_url: 'coastal-dental-preview.example',
      status: 'Won',
      potential_value: 2500,
      notes: 'Wants appointment requests and a team page.',
      created_at: dt(-40),
      last_contacted_at: dt(-3, '09:30'),
      history: [
        { days: -35, result: 'Spoke', notes: 'Initial call with office manager.' },
        { days: -28, type: 'Meeting', result: 'Meeting booked', notes: 'Presented the preview.' },
        { days: -21, result: 'Agreed to work together', notes: 'Signed! 50% deposit paid.' },
      ],
      project: { status: 'Development', start_date: d(-21), deadline: d(10), price: 2500, amount_paid: 1250, notes: 'Pages: Home, Services, Team, Contact. Waiting for team photos.' },
    },
    {
      business_name: 'Blue Wave Plumbing',
      contact_name: 'Tony Rivera',
      phone: '(555) 010-1010',
      category: 'Plumbing',
      location: 'Northgate',
      preview_url: 'bluewave-preview.example',
      status: 'Won',
      potential_value: 1600,
      notes: 'Emergency call button on every page.',
      created_at: dt(-30),
      last_contacted_at: dt(-4, '12:00'),
      history: [{ days: -18, result: 'Agreed to work together', notes: 'Agreed on the basic package.' }],
      project: { status: 'Client Review', start_date: d(-18), deadline: d(2), price: 1600, amount_paid: 800, notes: 'Client reviewing the draft. Wants a darker blue.' },
    },
    {
      business_name: 'Summit Fitness',
      contact_name: 'Jess Carter',
      phone: '(555) 010-1011',
      email: 'jess@summitfitness.example',
      category: 'Gym',
      location: 'Old Town',
      preview_url: 'summit-preview.example',
      live_url: 'summitfitness.example',
      status: 'Won',
      potential_value: 2200,
      notes: 'Class schedule + membership signup.',
      created_at: dt(-70),
      last_contacted_at: dt(-8, '17:00'),
      history: [{ days: -60, result: 'Agreed to work together', notes: 'Signed after second call.' }],
      project: { status: 'Completed', start_date: d(-60), deadline: d(-15), price: 2200, amount_paid: 2200, notes: 'Launched. Offer maintenance plan in 3 months.' },
    },
    {
      business_name: 'Old Town Florist',
      contact_name: 'Rose Martin',
      phone: '(555) 010-1012',
      category: 'Florist',
      location: 'Old Town',
      status: 'Lost',
      potential_value: 800,
      notes: 'Went with a Wix template instead.',
      created_at: dt(-35),
      last_contacted_at: dt(-20, '10:45'),
      history: [
        { days: -30, result: 'Interested', notes: 'Interested, asked for a quote.' },
        { days: -20, result: 'Spoke', notes: 'Decided to build it themselves.' },
      ],
    },
  ];

  await db.transaction(async () => {
    for (const { history, project, ...input } of leads) {
      const { lead } = await svc.createLead({ ...input, is_demo: true, notes: `[DEMO] ${input.notes}` });
      if (history) {
        // Replace the auto-created "initial call" with the full history.
        await db.run(`DELETE FROM interactions WHERE lead_id = ?`, [lead.id]);
        for (const h of history)
          await db.run(`INSERT INTO interactions (lead_id, type, date, notes, result, created_at) VALUES (?, ?, ?, ?, ?, ?)`, [
            lead.id,
            h.type ?? 'Phone Call',
            dt(h.days, '11:00'),
            h.notes,
            h.result,
            dt(h.days, '11:00'),
          ]);
      }
      if (project) {
        const p = await svc.ensureProject(lead.id, {});
        await svc.updateProject(p.id, project);
      }
    }
  });
}
