# Browser interface

[Back to the README](../README.md)

Besides the desktop app, EdgeTX Wingman Viewer can run in your web browser, with the same pages as the app. It needs [Node.js](https://nodejs.org) 22.18 or newer and the source (see [Development](development.md#running-from-source)):

```sh
npm install
npm run build
npm start
```

`npm start` (the same as `npm run cli -- ui`) starts the app on a free port and opens it in the browser. The pages work as described in the [README](../README.md#using-it). Stop it with Ctrl+C in the terminal.

The address it opens carries a key for this start behind `#`; without it other web pages and programs on the computer cannot use the interface, and the browser never sends it anywhere. To open the interface in another browser or window, run `npm start` again or copy the whole address the terminal shows.

Starting it a second time opens the running interface instead of starting another one. The port changes with every start, so a bookmark or a tab left open from an earlier start does not find the app again; run `npm start` instead.

The browser interface uses the same [data folder](../README.md#your-data-on-the-computer) as the desktop app: flights, notes, tags and settings are shared. Links to other sites and the map tiles load in the browser as on any other website.
