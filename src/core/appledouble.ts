import { rm } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';

// macOS keeps file metadata on FAT cards in "._<name>" files next to each file and folder it writes. They are of
// no use to the radio, so the app removes them.

// Removes the "._" file of one file or folder just written.
export async function dropAppleDouble(path: string): Promise<void> {
  await rm(join(dirname(path), `._${basename(path)}`), { force: true });
}
