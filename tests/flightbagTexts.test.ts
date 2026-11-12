import { describe, expect, it } from 'vitest';
import { choiceText, manifestText, resetText } from '../src/ui/flightbagTexts.ts';

describe('resetText', () => {
  it('finds a reset by its id, whatever its label says now', () => {
    const r = resetText('de', 'GPSHOMER', { id: 'flights', label: 'Clear last flights', ask: 'Clear the last flights list? Settings stay.' });
    expect(r.label).toBe('Letzte Flüge leeren');
  });

  it('keeps the label and question of the manifest in English', () => {
    const r = resetText('en', 'LIPONY', { id: 'factory', label: 'Factory reset', ask: 'Factory reset? All batteries, models, statistics and settings are erased.' });
    expect(r).toEqual({ label: 'Factory reset', title: 'Factory reset?', text: 'All batteries, models, statistics and settings are erased.' });
  });

  it('shows an unknown reset as the manifest has it', () => {
    const r = resetText('de', 'SNTNL', { id: 'sounds', label: 'Reset sounds', ask: 'Reset Link Sentinel sounds? Settings stay.' });
    expect(r).toEqual({ label: 'Reset sounds', title: 'Reset Link Sentinel sounds?', text: 'Settings stay.' });
  });

  it('finds the resets of Wingman by their ids', () => {
    expect(resetText('de', 'WINGMAN', { id: 'settings', label: 'Reset settings' }).title).toBe('Einstellungen von Wingman zurücksetzen?');
    expect(resetText('de', 'WINGMAN', { id: 'factory', label: 'Factory reset' }).label).toBe('Alles zurücksetzen');
  });
});

describe('manifestText', () => {
  it('finds the German by the field and part, whatever the English says now', () => {
    expect(manifestText('de', ['LIPONY.warnPct'], 'label', 'Low')).toBe('Akku niedrig');
    expect(manifestText('de', ['GPSHOMER.sound.lost'], 'hint', 'Fix gone')).toBe('GPS-Fix für einige Sekunden weg');
    expect(manifestText('de', ['MODELS.module.gps'], 'hint', 'GPS column …')).toContain('Suchseite');
  });

  it('keeps the English for another language, an unknown field or a part without German', () => {
    expect(manifestText('en', ['LIPONY.warnPct'], 'label', 'Battery low')).toBe('Battery low');
    expect(manifestText('de', ['LIPONY.newField'], 'label', 'New field')).toBe('New field');
    expect(manifestText('de', ['LIPONY.haptic'], 'hint', 'Buzz')).toBe('Buzz');
  });

  it('uses the first of a shared field\'s apps that has German', () => {
    expect(manifestText('de', ['NEWAPP.flightTime', 'WINGMAN.flightTime'], 'label', 'Flight time')).toBe('Flugzeit');
  });
});

describe('choiceText', () => {
  it('finds a choice by its value', () => {
    expect(choiceText('de', ['WINGMAN.barStyle'], 'zones', 'Zones')).toBe('Zonen');
    expect(choiceText('de', ['SNTNL.hapticStrength'], 3, 'Strong')).toBe('Stark');
  });

  it('keeps the English of a value without German', () => {
    expect(choiceText('de', ['WINGMAN.mascot'], 'quad', 'Quad')).toBe('Quad');
    expect(choiceText('de', ['WINGMAN.barStyle'], 'stripes', 'Stripes')).toBe('Stripes');
  });
});
