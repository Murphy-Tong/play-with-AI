import type { ZodType } from 'zod';

export type JsonValue = string | number | boolean | null | JsonValue[] | JsonObject;
export type JsonObject = { [key: string]: JsonValue };

export type Player = {
  id: string;
  name: string;
  avatarUrl?: string;
};

export type GameContext = {
  playerId: string;
  players: Player[];
};

export interface GameDefinition {
  id: string;
  title: string;
  description: string;
  minPlayers: number;
  maxPlayers: number;
  actionSchema?: ZodType<JsonObject>;
  initialState(players: Player[]): JsonObject;
  restart?(players: Player[], previousState: JsonObject): JsonObject;
  getPlayerView(state: JsonObject, context: GameContext): JsonObject;
  applyAction?(state: JsonObject, context: GameContext, action: JsonObject): {
    state: JsonObject;
    finished: boolean;
  };
}
