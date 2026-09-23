import { useState, type FormEvent } from 'react';
import { Lock, PhoneCall } from 'lucide-react';
import { useData } from '../lib/store';

export function Login() {
  const { login } = useData();
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      await login(password);
    } catch (err) {
      setError((err as Error).message);
      setPassword('');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="grid min-h-dvh place-items-center px-4">
      <form onSubmit={submit} className="card w-full max-w-sm space-y-5 p-6">
        <div className="flex items-center gap-2">
          <div className="grid size-9 place-items-center rounded-lg bg-accent text-white">
            <PhoneCall className="size-4" />
          </div>
          <div>
            <div className="font-semibold leading-tight">Callbook</div>
            <div className="text-xs text-muted">Cold-call CRM</div>
          </div>
        </div>
        <label className="block">
          <span className="label">Password</span>
          <div className="relative">
            <Lock className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted" />
            <input
              className="input !pl-9"
              type="password"
              autoFocus
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </div>
          {error && <span className="mt-1 block text-xs text-rose-600 dark:text-rose-400">{error}</span>}
        </label>
        <button className="btn btn-primary w-full" disabled={busy || !password}>
          {busy ? 'Checking…' : 'Log in'}
        </button>
      </form>
    </div>
  );
}
