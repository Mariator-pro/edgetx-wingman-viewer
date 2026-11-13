import { describe, expect, it } from 'vitest';
import { resetText } from '../src/ui/flightbagTexts.ts';

describe('resetText', () => {
  it('takes the question up to its question mark and the description as the text', () => {
    const r = resetText({ label: 'Statistiken zurücksetzen', ask: 'Alle Statistiken zurücksetzen? Zyklen und Archiv werden gelöscht.', desc: 'Zyklen und das Archiv werden gelöscht.' });
    expect(r).toEqual({ label: 'Statistiken zurücksetzen', title: 'Alle Statistiken zurücksetzen?', text: 'Zyklen und das Archiv werden gelöscht.' });
  });

  it('uses the rest of the question for an app without a description', () => {
    const r = resetText({ label: 'Factory reset', ask: 'Factory reset? All batteries, models, statistics and settings are erased.' });
    expect(r).toEqual({ label: 'Factory reset', title: 'Factory reset?', text: 'All batteries, models, statistics and settings are erased.' });
  });

  it('asks with the label when the app has no question', () => {
    expect(resetText({ label: 'Reset settings' })).toEqual({ label: 'Reset settings', title: 'Reset settings?', text: '' });
  });
});
