import type { User } from './types.js';

/** Native Juno wire contract. Hidden hands and draw order are server-only. */
export const JUNO_COLORS = ['coral', 'amber', 'mint', 'sky'] as const;
export type JunoColor = typeof JUNO_COLORS[number];
export type JunoFace = '0' | '1' | '2' | '3' | '4' | '5' | '6' | '7' | '8' | '9'
  | 'skip' | 'reverse' | 'draw2' | 'wild' | 'draw4' | 'memory' | 'intoxicated' | 'pizza';
export const JUNO_MAX_DECK_SIZE = 111;
export const JUNO_PIZZA_MS = 5_000;
export interface JunoCard { id: string; color: JunoColor | null; face: JunoFace; floured?: boolean }
export interface JunoPizzaTransfer { fromUserId: string; toUserId: string; amount: number }
export interface JunoPerson { userId: string; name: string; user?: User; nickname?: string | null; computer?: 1 | 2 | 3 | 4 | 5 }
export type JunoPlace = 1 | 2 | 3 | 4 | 5 | 6;
export const JUNO_MIN_PLAYERS = 2;
export const JUNO_MAX_PLAYERS = 6;
export const JUNO_BASE_XP: Record<JunoPlace, number> = { 1: 120, 2: 80, 3: 40, 4: 20, 5: 10, 6: 5 };

/**
 * Dynamic Juno XP: base placement award plus small deterministic bonuses.
 * Card pressure is the average opposing hand size (capped at +20): finishing
 * with fewer cards than the table around you pays more, even below the top.
 * Field size rewards beating larger tables, and stability rewards rounds
 * where nobody abandoned. Ties share the same inputs, so tied players keep
 * identical XP. All inputs are integers; the result is an integer >= base.
 */
export function junoDynamicXp(place: JunoPlace, ownCards: number, totalCompletedCards: number, completedCount: number, abandonedCount: number): number {
  const base = JUNO_BASE_XP[place];
  const opponents = Math.max(1, completedCount - 1);
  const cardBonus = Math.max(0, Math.min(20, Math.floor((totalCompletedCards - ownCards) / opponents)));
  const fieldBonus = completedCount >= 5 ? 10 : completedCount === 4 ? 5 : 0;
  const stabilityBonus = abandonedCount === 0 ? 5 : 0;
  return base + cardBonus + fieldBonus + stabilityBonus;
}
export interface JunoStanding extends JunoPerson {
  place: JunoPlace | null;
  cardCount: number | null;
  xp: number;
  outcome: 'completed' | 'abandoned' | 'unranked';
}
export interface JunoScoreboard {
  roundId: string;
  status: 'pending' | 'credited' | 'unranked';
  standings: JunoStanding[];
}
export interface JunoRankingMember {
  user: User;
  nickname: string | null;
  rank: number | null;
  totalXp: number;
  wins: number;
  completedRounds: number;
}
export interface JunoRankingPage {
  spaceId: string;
  limit: number;
  offset: number;
  total: number;
  entries: (JunoRankingMember & { rank: number })[];
  me: JunoRankingMember;
}
export type JunoAction = { type: 'join' | 'leave' | 'start' | 'rematch' | 'draw' | 'pass' | 'announce' | 'addBot' }
  | { type: 'removeBot'; botId: string }
  | { type: 'report'; targetUserId: string; opportunityId: string }
  | { type: 'play'; cardId: string; color?: JunoColor; announce?: boolean };
export type JunoCommand = { type: 'create' } | (JunoAction & { gameId: string; revision: number });
export interface JunoMove {
  type: 'start' | 'play' | 'draw' | 'pass' | 'timeout' | 'leave' | 'announce' | 'report' | 'memory_miss' | 'intoxicated_miss';
  /** Stable across refreshes; presentation must not replay the same action. */
  id?: string;
  userId: string;
  targetUserId?: string;
  card?: JunoCard;
  amount?: number;
  announced?: boolean;
  /** Private feedback: serialized only to the player whose attempt failed. */
  misplayedCard?: JunoCard;
  intoxicatedColor?: boolean;
  /** Public quantities only; transferred card identities stay private. */
  pizzaTransfers?: JunoPizzaTransfer[];
}
export interface JunoView {
  id: string;
  phase: 'lobby' | 'playing' | 'finished';
  hostId: string;
  players: (JunoPerson & { cardCount: number; announced: boolean; flouredCardCount?: number })[];
  hand: JunoCard[];
  topCard: JunoCard | null;
  color: JunoColor | null;
  direction: 1 | -1;
  currentPlayerId: string | null;
  drawnCardId: string | null;
  remainingMs: number;
  winnerId: string | null;
  result: 'emptyHand' | 'playersLeft' | 'stalemate' | 'expired' | null;
  lastMove: JunoMove | null;
  scoreboard?: JunoScoreboard | null;
  supportsBots?: boolean;
  supportsAnnounce?: boolean;
  supportsReports?: boolean;
  reportOpportunities?: JunoReportOpportunity[];
  practice?: boolean;
  memoryEnabled?: boolean;
  memoryCurse?: { id: string; targetUserId: string };
  intoxicatedEnabled?: boolean;
  intoxication?: { id: string; targetUserId: string };
  pizzaEnabled?: boolean;
  pizzaResolution?: { id: string; remainingMs: number };
  /** A cursed viewer receives opaque owned slots, never the concealed faces. */
  maskedHand?: { id: string }[];
}
export interface JunoSnapshot { revision: number; game: JunoView | null; supportsMemory?: boolean; supportsIntoxicated?: boolean; supportsPizza?: boolean; supportsSix?: boolean }
export const JUNO_TURN_MS = 45_000;
export const JUNO_REPORT_MS = 10_000;
export interface JunoReportOpportunity { id: string; targetUserId: string; remainingMs: number }

/** Presentation may highlight legal cards; the server rechecks every play. */
export function canPlayJuno(card: JunoCard, hand: readonly JunoCard[], top: JunoCard, color: JunoColor): boolean {
  if (card.face === 'draw4') return !hand.some(other => other.color === color);
  return card.face === 'memory' || card.face === 'intoxicated' || card.face === 'pizza' || card.face === 'wild' || card.color === color || card.face === top.face;
}
