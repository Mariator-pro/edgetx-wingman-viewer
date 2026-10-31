// Whether release a is newer than b ("v0.2.0", "0.1.0", "v0.2.0-rc1"); a release candidate comes before its release.
export function isNewer(a: string, b: string): boolean {
  const parts = (v: string) => {
    const [main = '', rc] = v.replace(/^v/, '').split(/-rc/i);
    const n = main.split('.').map((x) => parseInt(x, 10) || 0);
    return [n[0] ?? 0, n[1] ?? 0, n[2] ?? 0, rc === undefined ? Infinity : parseInt(rc, 10) || 0];
  };
  const x = parts(a);
  const y = parts(b);
  for (let i = 0; i < 4; i++) if (x[i] !== y[i]) return x[i]! > y[i]!;
  return false;
}
