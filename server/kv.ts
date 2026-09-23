// Minimal Redis-hash storage used by the CRM, with three backends:
//   • MemoryKV  — in-memory, optionally persisted to a JSON file (local dev, tests)
//   • UpstashKV — Upstash Redis over REST (Vercel's Redis integration: KV_REST_API_* / UPSTASH_REDIS_REST_*)
//   • TcpKV     — any Redis server via REDIS_URL (e.g. Redis Cloud)
import fs from 'node:fs';
import path from 'node:path';

export type Op = { op: 'hset'; key: string; field: string; value: string } | { op: 'hdel'; key: string; field: string } | { op: 'del'; key: string };

export interface KV {
  hgetall(key: string): Promise<Record<string, string>>;
  /** Fetches several hashes in one round trip. */
  hgetallMany(keys: string[]): Promise<Record<string, string>[]>;
  hincrby(key: string, field: string, by: number): Promise<number>;
  /** Applies all ops atomically (MULTI/EXEC). */
  exec(ops: Op[]): Promise<void>;
  /** Lists keys matching a glob pattern (maintenance only). */
  keys(pattern: string): Promise<string[]>;
}

// ─── memory / file ───────────────────────────────────────────────────────────

export class MemoryKV implements KV {
  protected data = new Map<string, Map<string, string>>();

  async hgetall(key: string) {
    return Object.fromEntries(this.data.get(key) ?? []);
  }
  async hgetallMany(keys: string[]) {
    return Promise.all(keys.map((k) => this.hgetall(k)));
  }
  async hincrby(key: string, field: string, by: number) {
    const h = this.hash(key);
    const n = Number(h.get(field) ?? 0) + by;
    h.set(field, String(n));
    await this.persist();
    return n;
  }
  async exec(ops: Op[]) {
    for (const o of ops) {
      if (o.op === 'hset') this.hash(o.key).set(o.field, o.value);
      else if (o.op === 'hdel') {
        this.data.get(o.key)?.delete(o.field);
        if (this.data.get(o.key)?.size === 0) this.data.delete(o.key);
      } else this.data.delete(o.key);
    }
    await this.persist();
  }
  async keys(pattern: string) {
    const re = new RegExp(`^${pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*')}$`);
    return [...this.data.keys()].filter((k) => re.test(k));
  }
  private hash(key: string) {
    let h = this.data.get(key);
    if (!h) this.data.set(key, (h = new Map()));
    return h;
  }
  protected async persist() {}
}

/** MemoryKV saved to a JSON file after every write (atomic rename). */
export class FileKV extends MemoryKV {
  constructor(private file: string) {
    super();
    if (fs.existsSync(file)) {
      const raw = JSON.parse(fs.readFileSync(file, 'utf8')) as Record<string, Record<string, string>>;
      for (const [k, h] of Object.entries(raw)) this.data.set(k, new Map(Object.entries(h)));
    }
  }
  static exists(file: string) {
    return fs.existsSync(file);
  }
  protected override async persist() {
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    const obj = Object.fromEntries([...this.data].map(([k, h]) => [k, Object.fromEntries(h)]));
    const tmp = `${this.file}.tmp`;
    await fs.promises.writeFile(tmp, JSON.stringify(obj));
    await fs.promises.rename(tmp, this.file);
  }
}

// ─── Upstash (REST) ────────────────────────────────────────────────────────────

/** HGETALL comes back as a flat [field, value, …] list when automatic deserialization is off. */
function toHash(raw: unknown): Record<string, string> {
  if (!raw) return {};
  if (!Array.isArray(raw)) return raw as Record<string, string>;
  const out: Record<string, string> = {};
  for (let i = 0; i < raw.length; i += 2) out[String(raw[i])] = String(raw[i + 1]);
  return out;
}

export async function upstashKV(url: string, token: string): Promise<KV> {
  const { Redis } = await import('@upstash/redis');
  // Values are our own JSON strings; keep them as-is instead of letting the SDK parse them.
  const redis = new Redis({ url, token, automaticDeserialization: false });
  return {
    async hgetall(key) {
      return toHash(await redis.hgetall(key));
    },
    async hgetallMany(keys) {
      if (!keys.length) return [];
      const p = redis.pipeline();
      for (const k of keys) p.hgetall(k);
      return ((await p.exec()) as unknown[]).map(toHash);
    },
    async hincrby(key, field, by) {
      return Number(await redis.hincrby(key, field, by));
    },
    async exec(ops) {
      if (!ops.length) return;
      const tx = redis.multi();
      for (const o of ops) {
        if (o.op === 'hset') tx.hset(o.key, { [o.field]: o.value });
        else if (o.op === 'hdel') tx.hdel(o.key, o.field);
        else tx.del(o.key);
      }
      await tx.exec();
    },
    async keys(pattern) {
      const out: string[] = [];
      let cursor: string | number = 0;
      do {
        const [next, batch] = (await redis.scan(cursor, { match: pattern, count: 500 })) as [string | number, string[]];
        cursor = next;
        out.push(...batch);
      } while (String(cursor) !== '0');
      return out;
    },
  };
}

// ─── Redis over TCP (REDIS_URL) ────────────────────────────────────────────────

export async function tcpKV(url: string): Promise<KV> {
  const { createClient } = await import('redis');
  const client = createClient({ url });
  client.on('error', (e) => console.error('Redis error', e));
  await client.connect();
  return {
    async hgetall(key) {
      return client.hGetAll(key);
    },
    async hgetallMany(keys) {
      if (!keys.length) return [];
      const m = client.multi();
      for (const k of keys) m.hGetAll(k);
      return (await m.exec()) as unknown as Record<string, string>[];
    },
    async hincrby(key, field, by) {
      return Number(await client.hIncrBy(key, field, by));
    },
    async exec(ops) {
      if (!ops.length) return;
      const m = client.multi();
      for (const o of ops) {
        if (o.op === 'hset') m.hSet(o.key, o.field, o.value);
        else if (o.op === 'hdel') m.hDel(o.key, o.field);
        else m.del(o.key);
      }
      await m.exec();
    },
    async keys(pattern) {
      const out: string[] = [];
      for await (const batch of client.scanIterator({ MATCH: pattern, COUNT: 500 })) out.push(...(Array.isArray(batch) ? batch : [batch]));
      return out;
    },
  };
}

/** Picks the remote Redis from environment variables, or returns undefined if none is configured. */
export async function remoteKvFromEnv(env = process.env): Promise<KV | undefined> {
  const restUrl = env.KV_REST_API_URL ?? env.UPSTASH_REDIS_REST_URL;
  const restToken = env.KV_REST_API_TOKEN ?? env.UPSTASH_REDIS_REST_TOKEN;
  if (restUrl && restToken) return upstashKV(restUrl, restToken);
  const url = env.REDIS_URL ?? env.KV_URL;
  if (url) return tcpKV(url);
  return undefined;
}
