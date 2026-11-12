// Errors the interface translates: a code with its values. The English text here is what the
// CLI prints and what the interface shows in English.
export const ERRORS = {
  busy: (p: { op: string }) => `Another task is still running (${p.op}). Try again when it’s done.`,
  notFound: () => 'Not found.',
  invalidRequest: (p: { what: string }) => `The request isn’t valid: ${p.what}`,
  flightNotFound: () => 'Can’t find this flight any more.',
  notLogFile: (p: { file: string }) => `${p.file} isn’t an EdgeTX log. Choose a .csv file from the LOGS folder of the SD card.`,
  logTooLarge: (p: { file: string }) => `${p.file} is larger than 100 MB.`,
  radioNotConnected: () => 'The radio is no longer connected.',
  licensesMissing: () => 'The list of open source licenses is missing. Build the app first with “npm run build”.',
  appUpdateFailed: () => 'Couldn’t download the app update. Check your internet connection and try again.',
  flightBagMissing: () => 'Flight Bag isn’t on this radio’s SD card. It comes with each of the Lua apps; copy one of them onto the card again.',
  flightBagOld: () => 'Flight Bag on this radio’s SD card is too old for this app. Copy the latest version of one of the Lua apps onto the card.',
  flightBagNew: () => 'Flight Bag on this radio’s SD card is newer than this app. Update Wingman Viewer.',
  flightBagRule: (p: { detail: string }) => p.detail,
  flightBagFailed: (p: { detail: string }) => `A Lua app on the SD card stopped with an error: ${p.detail}`,
};

export type ErrorCode = keyof typeof ERRORS;
export type ErrorArgs<C extends ErrorCode> = Parameters<(typeof ERRORS)[C]>;

export class AppError<C extends ErrorCode = ErrorCode> extends Error {
  code: C;
  params?: ErrorArgs<C>[0];
  constructor(code: C, ...args: ErrorArgs<C>) {
    super((ERRORS[code] as (...a: ErrorArgs<C>) => string)(...args));
    this.code = code;
    this.params = args[0];
  }
}

// How an error travels to the interface: the English text, and the code when there is one.
export interface ErrorInfo {
  message: string;
  code?: ErrorCode;
  params?: unknown;
}

export function errorInfo(e: unknown): ErrorInfo {
  const message = e instanceof Error ? e.message : String(e);
  return e instanceof AppError ? { message, code: e.code, params: e.params } : { message };
}
