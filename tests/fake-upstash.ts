// A tiny in-process imitation of Upstash's REST protocol (single commands, /pipeline,
// /multi-exec, base64 response encoding) so the real @upstash/redis client can be tested offline.
import http from 'node:http';

export function fakeUpstash() {
  const data = new Map<string, Map<string, string>>();
  const hash = (k: string) => data.get(k) ?? (data.set(k, new Map()), data.get(k)!);
  let requests = 0;

  function run([cmd, ...a]: string[]): unknown {
    switch (cmd.toLowerCase()) {
      case 'hgetall':
        return [...(data.get(a[0]) ?? [])].flat();
      case 'hset':
        for (let i = 1; i < a.length; i += 2) hash(a[0]).set(a[i], String(a[i + 1]));
        return 1;
      case 'hdel': {
        const ok = data.get(a[0])?.delete(a[1]);
        if (data.get(a[0])?.size === 0) data.delete(a[0]);
        return ok ? 1 : 0;
      }
      case 'del':
        return data.delete(a[0]) ? 1 : 0;
      case 'hincrby': {
        const n = Number(hash(a[0]).get(a[1]) ?? 0) + Number(a[2]);
        hash(a[0]).set(a[1], String(n));
        return n;
      }
      case 'scan': {
        const i = a.findIndex((x) => /^match$/i.test(x));
        const re = new RegExp(`^${a[i + 1].replace(/\*/g, '.*')}$`);
        return ['0', [...data.keys()].filter((k) => re.test(k))];
      }
      default:
        throw new Error(`fake upstash: unsupported command ${cmd}`);
    }
  }
  const b64 = (v: unknown): unknown => (typeof v === 'string' ? Buffer.from(v).toString('base64') : Array.isArray(v) ? v.map(b64) : v);

  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c)).on('end', () => {
      requests++;
      const enc = req.headers['upstash-encoding'] === 'base64' ? b64 : (x: unknown) => x;
      const json = JSON.parse(body || '[]');
      const batch = req.url?.startsWith('/pipeline') || req.url?.startsWith('/multi-exec');
      const out = batch ? json.map((c: string[]) => ({ result: enc(run(c)) })) : { result: enc(run(json)) };
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify(out));
    });
  });

  return {
    async start() {
      await new Promise<void>((r) => server.listen(0, r));
      return `http://localhost:${(server.address() as { port: number }).port}`;
    },
    stop: () => new Promise<void>((r) => server.close(() => r())),
    keys: () => [...data.keys()].sort(),
    requests: () => requests,
  };
}
