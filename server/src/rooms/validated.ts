import type { Client, Room } from 'colyseus';
import type { z } from 'zod';
import { log } from '../log.js';

/**
 * Register a message handler whose payload is validated with a shared Zod schema.
 * Invalid payloads are rejected and logged; the client stays connected (Colyseus'
 * built-in validator would disconnect it instead).
 */
export function onValidated<S extends z.ZodType>(
  room: Room,
  type: string,
  schema: S,
  handler: (client: Client, payload: z.infer<S>) => void,
): void {
  room.onMessage(type, (client: Client, payload: unknown) => {
    const result = schema.safeParse(payload);
    if (!result.success) {
      log.warn('invalid message rejected', {
        room: room.roomName,
        roomId: room.roomId,
        sessionId: client.sessionId,
        type,
        issues: result.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`),
      });
      return;
    }
    handler(client, result.data);
  });
}

/** Log (and ignore) any message type that has no registered handler. */
export function rejectUnknownMessages(room: Room): void {
  room.onMessage('*', (client: Client, type: string | number) => {
    log.warn('unknown message type rejected', {
      room: room.roomName,
      sessionId: client.sessionId,
      type,
    });
  });
}
