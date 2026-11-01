// Which pages may open the lobby socket: pages on loopback or the local network, and the page this
// server served under a bare intranet name. A page on the internet could otherwise drive the lobby through a captain's
// browser. This keeps the server LAN-only; it is not authentication.

const LOCAL_SUFFIXES = ['.local', '.lan', '.home.arpa'];

function ipv4(h: string): number[] | null {
  const parts = h.split('.');
  if (parts.length !== 4 || parts.some((p) => !/^\d{1,3}$/.test(p))) return null;
  const n = parts.map(Number);
  return n.every((x) => x <= 255) ? n : null;
}

function localIpv4([a, b]: number[]): boolean {
  return a === 127 || a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 169 && b === 254);
}

function localIpv6(h: string): boolean {
  if (h === '::1') return true;
  const first = h.split(':')[0];
  // fc00::/7 (unique local) and fe80::/10 (link-local).
  return /^f[cd][0-9a-f]{2}$/.test(first) || /^fe[89ab][0-9a-f]$/.test(first);
}

/** May a page from `origin` (the Origin header, if any) open the lobby socket on `host` (the Host header)? */
export function originAllowed(origin: string | undefined, host: string | undefined): boolean {
  if (origin === undefined) return true;
  let url: URL;
  try {
    url = new URL(origin);
  } catch {
    return false;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return false;
  const h = url.hostname.toLowerCase();
  if (h === 'localhost') return true;
  if (h.startsWith('[')) return localIpv6(h.slice(1, -1));
  const v4 = ipv4(h);
  if (v4) return localIpv4(v4);
  if (LOCAL_SUFFIXES.some((s) => h.endsWith(s) && h.length > s.length)) return true;
  // A bare intranet name (no dots) only for the page this server served under it. A public name
  // never passes on matching the Host header alone: after a DNS rebind, an internet page's Origin
  // and Host both carry its own name.
  return !h.includes('.') && !!host && url.host === host.toLowerCase();
}
