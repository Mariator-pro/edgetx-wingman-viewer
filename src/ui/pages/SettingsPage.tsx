import { Button, Card, Description, FieldError, Input, Label, TextField, ToggleButton, ToggleButtonGroup } from '@heroui/react';
import { useEffect, useState } from 'react';
import type { MapSettingsView } from '../../server/api.ts';
import { isStickMode } from '../../core/kinds.ts';
import { get, post } from '../api.ts';
import { usePrefs } from '../usePrefs.ts';

type Run = (fn: () => Promise<unknown>) => void;

export function SettingsPage({ run }: { run: Run }) {
  const { t, sticks, setSticks } = usePrefs();
  return (
    <div className="flex flex-col gap-6">
      <h1 className="m-0 text-3xl font-bold tracking-tight">{t.settings}</h1>
      <MapCard run={run} />
      <Card>
        <Card.Header>
          <Card.Title>{t.stickMode}</Card.Title>
          <Card.Description>{t.stickModeText}</Card.Description>
        </Card.Header>
        <Card.Footer>
          <ToggleButtonGroup
            aria-label={t.stickMode}
            selectionMode="single"
            disallowEmptySelection
            selectedKeys={[String(sticks)]}
            onSelectionChange={(k) => {
              const m = Number([...k][0]);
              if (isStickMode(m)) setSticks(m);
            }}
          >
            {[1, 2, 3, 4].map((m) => (
              <ToggleButton key={m} id={String(m)}>
                {t.stickModeShort(m)}
              </ToggleButton>
            ))}
          </ToggleButtonGroup>
        </Card.Footer>
      </Card>
      <Card>
        <Card.Header>
          <Card.Title>{t.dataFolder}</Card.Title>
          <Card.Description>{t.dataFolderText}</Card.Description>
        </Card.Header>
        <Card.Footer>
          <Button variant="outline" onPress={() => run(() => post('/api/open-folder'))}>
            {t.openFolder}
          </Button>
        </Card.Footer>
      </Card>
      <Card>
        <Card.Header>
          <Card.Title>{t.about}</Card.Title>
          <Card.Description>
            EdgeTX Wingman Viewer · {t.version(__APP_VERSION__)}
            <br />
            {t.license}
          </Card.Description>
        </Card.Header>
      </Card>
    </div>
  );
}

const validTiles = (v: string) => /^https:\/\/[^\s/@]+\/\S*$/.test(v) && ['{z}', '{x}', '{y}'].every((p) => v.includes(p));
const validKey = (v: string) => v === '' || /^[\w.-]+$/.test(v);

// The street map's tile address and the user's own key for satellite imagery. The server allows the page
// to load from these servers only, so the page loads again after saving.
function MapCard({ run }: { run: Run }) {
  const { t } = usePrefs();
  const [saved, setSaved] = useState<MapSettingsView>();
  const [tiles, setTiles] = useState('');
  const [key, setKey] = useState('');
  const [note, setNote] = useState(false);
  useEffect(() => {
    get<MapSettingsView>('/api/map').then((m) => {
      setSaved(m);
      setTiles(m.tiles);
      setKey(m.arcgisKey ?? '');
    }, () => {});
  }, []);
  if (!saved) return null;
  const changed = tiles.trim() !== saved.tiles || key.trim() !== (saved.arcgisKey ?? '');
  const ok = validTiles(tiles.trim()) && validKey(key.trim());
  const save = () =>
    run(async () => {
      await post('/api/map', { tiles: tiles.trim(), arcgisKey: key.trim() });
      setNote(true);
      setTimeout(() => location.reload(), 1200);
    });
  return (
    <Card>
      <Card.Header>
        <Card.Title>{t.mapSettings}</Card.Title>
        <Card.Description>{t.mapSettingsText}</Card.Description>
      </Card.Header>
      <Card.Content className="flex flex-col gap-4">
        <div className="flex flex-wrap items-end gap-2">
          <TextField variant="secondary" className="min-w-80 flex-1" value={tiles} onChange={setTiles} isInvalid={!validTiles(tiles.trim())}>
            <Label>{t.tileAddress}</Label>
            <Input className="font-mono text-sm" spellCheck={false} />
            <Description>{t.tileAddressHint}</Description>
            <FieldError>{t.tileAddressInvalid}</FieldError>
          </TextField>
          {tiles.trim() !== saved.defaultTiles && (
            <Button variant="outline" onPress={() => setTiles(saved.defaultTiles)}>
              {t.resetTiles}
            </Button>
          )}
        </div>
        <TextField variant="secondary" value={key} onChange={setKey} isInvalid={!validKey(key.trim())}>
          <Label>{t.arcgisKey}</Label>
          <Input type="password" autoComplete="off" spellCheck={false} />
          <Description>{t.arcgisKeyText}</Description>
          <FieldError>{t.arcgisKeyInvalid}</FieldError>
        </TextField>
        {note && <p className="m-0 text-sm text-muted">{t.mapSaved}</p>}
      </Card.Content>
      <Card.Footer>
        <Button isDisabled={!changed || !ok || note} onPress={save}>
          {t.save}
        </Button>
      </Card.Footer>
    </Card>
  );
}
