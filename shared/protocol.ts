import type { Action, RoomState, SequencedAction } from './room';
import type { LeaderboardEntry } from './types';

export interface Presence {
  id: string;
  map: string;
  x: number;           // tile coords (float while walking)
  y: number;
  dir: 0 | 1 | 2 | 3;  // down, left, right, up
  moving: boolean;
  emote?: string;
  t: number;
}

export type ClientMsg =
  | { type: 'hello'; room: string; name: string; avatar: number; clientId: string }
  | { type: 'action'; action: Action }
  | { type: 'presence'; p: Presence }
  | { type: 'ping'; t: number };

export type ServerMsg =
  | { type: 'welcome'; playerId: string; state: RoomState; roomId: string }
  | { type: 'action'; sa: SequencedAction }
  | { type: 'presence'; p: Presence }
  | { type: 'gone'; id: string }
  | { type: 'error'; message: string }
  | { type: 'pong'; t: number };

export interface LeaderboardQuery { objectiveId?: string; seed?: string; difficulty?: string }
export type { LeaderboardEntry };

export function normalizeRoom(code: string): string {
  return (code || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8) || 'NASA01';
}
