import { EventEmitter } from 'node:events';

/**
 * In-process notifications between rooms (single game-server process). HouseRoom emits
 * `changed` after reloading a house so town rooms can redraw its exterior.
 */
export const houseEvents = new EventEmitter<{ changed: [ownerId: string] }>();
houseEvents.setMaxListeners(0);
