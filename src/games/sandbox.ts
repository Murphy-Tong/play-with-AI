import type { GameDefinition } from '../game.ts';

export const sandboxGame: GameDefinition = {
  id: 'sandbox',
  title: '默契试验场',
  description: 'Two-player chat room. Say hello, find some chemistry, and keep talking. No turns, actions or win condition. Only the latest 200 messages are kept.',
  minPlayers: 2,
  maxPlayers: 2,
  initialState: () => ({}),
  getPlayerView: (state) => state,
};
