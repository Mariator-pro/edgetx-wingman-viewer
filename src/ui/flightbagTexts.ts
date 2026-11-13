// A reset of an app as the card's files describe it, in the interface's language: its label, the question
// (the manifest's question up to its question mark) and what it does (the manifest's description, or the
// rest of the question for an app that has none).
export function resetText(r: { label: string; ask?: string; desc?: string }): { label: string; title: string; text: string } {
  const ask = r.ask ?? '';
  const i = ask.indexOf('?');
  const title = i < 0 ? ask || `${r.label}?` : ask.slice(0, i + 1);
  return { label: r.label, title, text: r.desc ?? (i < 0 ? '' : ask.slice(i + 1).trim()) };
}
