/**
 * SSE (Server-Sent Events) parser helpers built on fetch + ReadableStream.
 *
 * The actual streaming consumption lives in `lib/api.ts#streamChat`.
 * This module exposes the low-level parser primitives so callers (or tests)
 * can parse a SSE byte stream incrementally.
 */

export interface SSEEvent {
  event: string;
  data: string;
}

/**
 * Split a raw SSE payload (which may contain multiple events) into events.
 * Events are separated by a blank line (`\n\n`).
 */
export function splitSSEBlocks(buffer: string): { events: SSEEvent[]; rest: string } {
  const events: SSEEvent[] = [];
  let working = buffer;
  let idx: number;
  while ((idx = working.indexOf("\n\n")) !== -1) {
    const raw = working.slice(0, idx);
    working = working.slice(idx + 2);
    const ev = parseOneBlock(raw);
    if (ev) events.push(ev);
  }
  return { events, rest: working };
}

function parseOneBlock(raw: string): SSEEvent | null {
  const lines = raw.split(/\r?\n/);
  let eventName = "message";
  const dataLines: string[] = [];
  for (const line of lines) {
    if (line.startsWith("event:")) {
      eventName = line.slice(6).trim();
    } else if (line.startsWith("data:")) {
      dataLines.push(line.slice(5).replace(/^ /, ""));
    }
  }
  if (dataLines.length === 0) return null;
  return { event: eventName, data: dataLines.join("\n") };
}

/**
 * Decode a SSE data line as JSON with a runtime type guard.
 */
export function parseJSONData<T = unknown>(data: string): T | null {
  try {
    return JSON.parse(data) as T;
  } catch {
    return null;
  }
}
