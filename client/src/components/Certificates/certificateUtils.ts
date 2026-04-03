export function parseDomains(text: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];

  for (const part of String(text || '').split(/[\s,;]+/g)) {
    let domain = String(part || '').trim().toLowerCase();
    if (!domain) continue;
    domain = domain.replace(/^https?:\/\//, '').replace(/\/.*$/, '').replace(/\.$/, '');
    const wildcard = domain.startsWith('*.') ? '*.' : '';
    const body = wildcard ? domain.slice(2) : domain;
    if (!body) continue;
    const normalized = `${wildcard}${body}`;
    if (seen.has(normalized)) continue;
    seen.add(normalized);
    out.push(normalized);
  }

  return out;
}

export function triggerDownload(blob: Blob, filename: string) {
  const url = window.URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  window.URL.revokeObjectURL(url);
}
