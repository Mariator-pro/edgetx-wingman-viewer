// Set by Vite from package.json.
declare const __APP_VERSION__: string;

// A worker built by Vite, imported as the address of its file.
declare module '*?worker&url' {
  const url: string;
  export default url;
}
