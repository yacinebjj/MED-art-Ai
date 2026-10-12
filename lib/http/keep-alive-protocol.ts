/** Shared by the server wrapper (lib/http/keep-alive.ts) and the browser client (lib/http/fetch-keep-alive.ts). */
export const KEEP_ALIVE_HEADER = "x-medart-keep-alive";

export type KeepAliveFrame =
  /** `at` = server clock when the request was accepted; lets a client recognize a result saved by THIS request. */
  | { type: "open"; at: number }
  | { type: "heartbeat"; chars: number }
  | { type: "progress"; chars: number }
  | { type: "result"; status: number; headers: Record<string, string>; body: string };
