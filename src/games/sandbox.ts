import * as z from 'zod';
import type { GameDefinition, JsonValue } from '../game.ts';

export const sandboxGame: GameDefinition = {
  id: 'sandbox',
  title: 'Protocol sandbox',
  description: 'Two-player MCP integration demo, not a competitive game. Both players may send messages at any time once joined. No turns or win condition. Only the latest 50 messages are kept.',
  minPlayers: 2,
  maxPlayers: 2,
  actionSchema: z.strictObject({
    type: z.literal('message'),
    text: z.string().trim().min(1).max(2000),
  }),
  initialState: () => ({ messages: [] }),
  getPlayerView: (state) => state,
  applyAction: (state, context, action) => ({
    state: {
      messages: [
        ...(state.messages as JsonValue[]),
        { playerId: context.playerId, text: action.text! },
      ].slice(-50),
    },
    finished: false,
  }),
};
