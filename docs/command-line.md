# Command line

[Back to the README](../README.md)

The command line lists flights and exports them from the terminal, e.g. to save many flights at once. The map, timeline and charts are only in the app. It needs [Node.js](https://nodejs.org) 22.18 or newer, the source and `npm install` (see [Development](development.md#running-from-source)).

```sh
npm run cli -- <command> [path] [options]
```

| Command | What it does |
|---|---|
| `ui` | opens the app in the browser (see [Browser interface](browser-interface.md)) |
| `flights` | lists the flights |
| `export` | saves flights as GPX, KML or CSV |

`path` is a log file, a folder of logs or an SD card (or its `LOGS` folder). Without a path, `flights` and `export` use the logs the app keeps, after copying new ones from a connected radio like the app does ("3 new flights from tx15"). With an SD card as the path, the commands also read its model files and the settings of your Lua projects.

## List flights

```sh
npm run cli -- flights
npm run cli -- flights /Volumes/TX15
```

`flights` shows every flight, sorted by start time, with its number, model, radio type, start, duration (takeoff to landing), maximum distance from the start, maximum altitude in the unit of the log and the number of hints. Lines the app can't read are counted per file ("…: 120 lines skipped (cut off, or sensors changed while logging)").

## Export flights

```sh
npm run cli -- export --format kml --out ~/Flights
npm run cli -- export --flight 12 --format csv
```

`export` saves every flight in the path, or only the one named with `--flight <n>` (the number from `flights`, with the same path).

- `--format gpx|kml|csv`: GPX (default) for maps and most apps, KML with a time track for map programs with a time slider, CSV with only the lines of that flight, as EdgeTX writes them.
- `--out <folder>`: where to save the files (default: the current folder).

Files are named `<model>-<YYYY-MM-DD-HHMMSS>.<gpx|kml|csv>`. GPX and KML hold the lines from before takeoff to the last line with telemetry, split where the GPS had no fix for 3 seconds or longer. The time in the log is taken as the local time of the computer.

## Without a connected radio

`WINGMAN_VIEWER_VOLUMES=<folder>` replaces the search for drives: the commands, the browser interface and `npm run dev` treat the folder as a connected drive, for example a copy of an SD card (several folders separated like in `PATH`). Use a copy: "Clean up SD card" deletes logs there as on a real card.

The command line uses the same [data folder](../README.md#your-data-on-the-computer) as the app: copied logs are shared.
