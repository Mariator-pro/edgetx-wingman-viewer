// fengari ships without types; the few parts used are typed where they are used.
declare module 'fengari' {
  const fengari: {
    lua: any;
    lauxlib: any;
    lualib: any;
    to_luastring: (s: string) => Uint8Array;
  };
  export default fengari;
}
