export function isPrivateIP(ip: string): boolean {
  const host = ip.toLowerCase().replace(/^\[|\]$/g, '');
  const ipv4 = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (ipv4) {
    const a = Number(ipv4[1]);
    const b = Number(ipv4[2]);
    if (a === 0) return true;
    if (a === 10) return true;
    if (a === 127) return true;
    if (a === 100 && b >= 64 && b <= 127) return true;
    if (a === 169 && b === 254) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    if (a >= 224) return true;
    return false;
  }
  if (host.includes(':')) {
    if (host === '::' || host === '::1') return true;
    if (/^f[cde]/.test(host)) return true;
    if (/^ff/.test(host)) return true;
    if (host.startsWith('::ffff:')) {
      const mapped = host.slice(7);
      return mapped.includes('.') ? isPrivateIP(mapped) : false;
    }
    return false;
  }
  return false;
}

export function isInternalHostname(host: string): boolean {
  const h = host.toLowerCase().replace(/^\[|\]$/g, '');
  if (h === 'localhost' || h.endsWith('.localhost') || h.endsWith('.local') || h.endsWith('.internal')) {
    return true;
  }
  return isPrivateIP(h);
}
