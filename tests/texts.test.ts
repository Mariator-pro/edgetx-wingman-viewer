import { describe, expect, it } from 'vitest';
import { ERRORS } from '../src/core/errors.ts';
import { TEXTS } from '../src/ui/texts.ts';

// Every text of the English interface in every language, functions where English has functions.
function shape(v: unknown): unknown {
  if (typeof v === 'function') return 'fn';
  if (typeof v === 'object' && v !== null) return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, shape(x)]).sort(([a], [b]) => String(a).localeCompare(String(b))));
  return typeof v;
}

describe('texts', () => {
  it('German has all texts of English', () => {
    expect(shape(TEXTS.de)).toEqual(shape(TEXTS.en));
  });

  it('every server error has a German text', () => {
    expect(Object.keys(TEXTS.de.errors).sort()).toEqual(Object.keys(ERRORS).sort());
  });

  it('counts in English and German', () => {
    expect([TEXTS.en.newFlights(1), TEXTS.en.newFlights(3), TEXTS.de.newFlights(1), TEXTS.de.newFlights(3)]).toEqual(['1 new flight', '3 new flights', '1 neuer Flug', '3 neue Flüge']);
  });
});
