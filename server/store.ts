// Per-request unit of work over the KV hashes: reads are cached, writes are
// buffered (and visible to later reads), and commit() applies them atomically.
import type { KV, Op } from './kv.ts';

/** Redis key layout. Each hash maps id → JSON record. */
export const K = {
  settings: 'crm:settings',
  seq: 'crm:seq',
  leads: 'crm:leads',
  projects: 'crm:projects',
  /** Open (not completed) reminders only; completed ones move to the lead's history. */
  reminders: 'crm:reminders',
  /** Compact copy of every interaction for analytics (id, lead_id, type, date, result). */
  calls: 'crm:calls',
  everInterested: 'crm:ever_interested',
  leadInteractions: (id: number) => `crm:lead:${id}:interactions`,
  leadActivities: (id: number) => `crm:lead:${id}:activities`,
  leadReminders: (id: number) => `crm:lead:${id}:reminders`,
};

type Overlay = Map<string, string | null>; // field → value, or null for deleted

export class Store {
  private cache = new Map<string, Map<string, unknown>>();
  private overlay = new Map<string, Overlay>();
  private deletedKeys = new Set<string>();
  private ops: Op[] = [];
  private lastId = 0;

  constructor(readonly kv: KV) {}

  /** Loads several hashes in one round trip (already-loaded ones are skipped). */
  async load(...keys: string[]) {
    const missing = [...new Set(keys)].filter((k) => !this.cache.has(k));
    if (!missing.length) return;
    const raw = await this.kv.hgetallMany(missing);
    missing.forEach((key, i) => {
      const map = new Map<string, unknown>();
      if (!this.deletedKeys.has(key)) for (const [f, v] of Object.entries(raw[i])) map.set(f, JSON.parse(v));
      for (const [f, v] of this.overlay.get(key) ?? []) v === null ? map.delete(f) : map.set(f, JSON.parse(v));
      this.cache.set(key, map);
    });
  }

  async values<T>(key: string): Promise<T[]> {
    await this.load(key);
    return [...this.cache.get(key)!.values()] as T[];
  }

  async get<T>(key: string, field: string | number): Promise<T | undefined> {
    await this.load(key);
    return this.cache.get(key)!.get(String(field)) as T | undefined;
  }

  set(key: string, field: string | number, value: unknown) {
    const f = String(field);
    const json = JSON.stringify(value);
    this.cache.get(key)?.set(f, JSON.parse(json));
    this.overlayFor(key).set(f, json);
    this.ops.push({ op: 'hset', key, field: f, value: json });
  }

  del(key: string, field: string | number) {
    const f = String(field);
    this.cache.get(key)?.delete(f);
    this.overlayFor(key).set(f, null);
    this.ops.push({ op: 'hdel', key, field: f });
  }

  delKey(key: string) {
    this.cache.set(key, new Map());
    this.overlay.delete(key);
    this.deletedKeys.add(key);
    this.ops.push({ op: 'del', key });
  }

  /** Short sequential ids for leads (they appear in URLs). */
  async nextLeadId(): Promise<number> {
    return this.kv.hincrby(K.seq, 'leads', 1);
  }

  /** Unique, increasing ids for everything else without a round trip. */
  nextId(): number {
    this.lastId = Math.max(this.lastId + 1, Date.now() * 1000 + Math.floor(Math.random() * 1000));
    return this.lastId;
  }

  async commit() {
    const ops = this.ops;
    this.ops = [];
    await this.kv.exec(ops);
  }

  private overlayFor(key: string) {
    let o = this.overlay.get(key);
    if (!o) this.overlay.set(key, (o = new Map()));
    return o;
  }
}
