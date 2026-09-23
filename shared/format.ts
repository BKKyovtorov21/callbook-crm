import { parsePhoneNumberFromString, type CountryCode } from 'libphonenumber-js';

/** Adds https:// to bare domains. Returns '' for blank input. */
export function normalizeUrl(input: string | null | undefined): string {
  const v = (input ?? '').trim();
  if (!v) return '';
  return /^[a-z][a-z0-9+.-]*:\/\//i.test(v) ? v : `https://${v}`;
}

export function isValidUrl(input: string | null | undefined): boolean {
  const v = normalizeUrl(input);
  if (!v) return true;
  try {
    const u = new URL(v);
    return (u.protocol === 'http:' || u.protocol === 'https:') && /\.[a-z]{2,}$|^localhost$/i.test(u.hostname);
  } catch {
    return false;
  }
}

export function isValidEmail(input: string | null | undefined): boolean {
  const v = (input ?? '').trim();
  return !v || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);
}

export function phoneDigits(input: string | null | undefined): string {
  return (input ?? '').replace(/\D/g, '');
}

function parse(input: string, country: string) {
  try {
    return parsePhoneNumberFromString(input, (country || 'US') as CountryCode);
  } catch {
    return undefined;
  }
}

/** Pretty phone number: national format for the home country, international otherwise. */
export function formatPhone(input: string | null | undefined, country = 'US'): string {
  const v = (input ?? '').trim();
  if (!v) return '';
  const p = parse(v, country);
  if (!p || !p.isPossible()) return v;
  return p.country === country ? p.formatNational() : p.formatInternational();
}

/** Value for a tel: link (E.164 when parseable). */
export function telHref(input: string | null | undefined, country = 'US'): string {
  const v = (input ?? '').trim();
  const p = parse(v, country);
  return `tel:${p?.isPossible() ? p.number : v.replace(/[^\d+]/g, '')}`;
}

export function isPossiblePhone(input: string | null | undefined, country = 'US'): boolean {
  const v = (input ?? '').trim();
  if (phoneDigits(v).length < 5) return false;
  const p = parse(v, country);
  return p ? p.isPossible() : phoneDigits(v).length >= 7;
}
