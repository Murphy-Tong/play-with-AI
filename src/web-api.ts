import express from 'express';
import type { ErrorRequestHandler, Request, Router } from 'express';
import * as z from 'zod';
import { RoomError } from './errors.ts';
import type { JsonObject } from './game.ts';
import type { RoomStore } from './rooms.ts';

class InputError extends Error {}
class AuthError extends Error {}

const roomIdSchema = z.uuid();
const playerNameSchema = z.string().trim().min(1).max(40);
const tokenSchema = z.string().min(1).max(256);
const avatarUrlSchema = z.string().trim().max(500).optional();
const createSchema = z.strictObject({
  gameId: z.string().trim().min(1).max(64),
  playerName: playerNameSchema,
  avatarUrl: avatarUrlSchema,
});
const joinSchema = z.strictObject({
  inviteToken: tokenSchema,
  playerName: playerNameSchema,
  avatarUrl: avatarUrlSchema,
});
const actionSchema = z.strictObject({
  expectedVersion: z.number().int().min(1),
  action: z.record(z.string(), z.unknown()),
});
const chatSchema = z.strictObject({ text: z.string().max(500) });

const roomStatus: Record<string, number> = {
  GAME_NOT_FOUND: 404,
  ROOM_NOT_FOUND: 404,
  UNAUTHORIZED: 401,
  INVALID_INVITE: 403,
  ROOM_FULL: 409,
  ROOM_NOT_READY: 409,
  ROOM_FINISHED: 409,
  VERSION_CONFLICT: 409,
  INVALID_ACTION: 400,
  INVALID_MESSAGE: 400,
  ROOM_NOT_FINISHED: 409,
};

function sendError(res: express.Response, status: number, code: string, message: string) {
  res.status(status).json({ error: { code, message } });
}

function parse<T>(schema: z.ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value);
  if (!result.success) throw new InputError();
  return result.data;
}

function parseRoomId(value: string | string[] | undefined): string {
  const parsed = roomIdSchema.safeParse(value);
  if (!parsed.success) throw new InputError();
  return parsed.data;
}

function bearer(req: Request): string {
  const header = req.headers.authorization ?? '';
  const parts = header.split(' ');
  if (parts.length !== 2 || parts[0] !== 'Bearer' || !parts[1] || parts[1].length > 256) throw new AuthError();
  return parts[1];
}

const jsonBody = [express.json({ limit: '64kb' })];
function requireJson(req: Request, res: express.Response, next: express.NextFunction) {
  if (!req.is('application/json')) {
    sendError(res, 415, 'UNSUPPORTED_MEDIA_TYPE', 'Send the request body as JSON.');
    return;
  }
  next();
}

export function createWebApi(store: RoomStore): Router {
  const router = express.Router();

  router.use((req, res, next) => {
    res.setHeader('Cache-Control', 'no-store');
    if (req.headers['sec-fetch-site'] === 'cross-site') {
      sendError(res, 403, 'FORBIDDEN', 'Cross-site requests are not allowed.');
      return;
    }
    const origin = req.headers.origin;
    const host = req.headers.host;
    if (origin !== undefined && (!host || origin !== `http://${host}`)) {
      sendError(res, 403, 'FORBIDDEN', 'This request did not come from this playground page.');
      return;
    }
    next();
  });

  router.get('/games', (_req, res) => {
    res.json({ games: store.listGames() });
  });

  router.post('/rooms', requireJson, ...jsonBody, (req, res) => {
    const body = parse(createSchema, req.body);
    res.status(201).json(store.createRoom(body));
  });

  router.post('/rooms/:roomId/join', requireJson, ...jsonBody, (req, res) => {
    const roomId = parseRoomId(req.params.roomId);
    const body = parse(joinSchema, req.body);
    res.json(store.joinRoom({ roomId, ...body }));
  });

  router.get('/rooms/:roomId', (req, res) => {
    res.json(store.getRoom({ roomId: parseRoomId(req.params.roomId), playerToken: bearer(req) }));
  });

  router.post('/rooms/:roomId/actions', requireJson, ...jsonBody, (req, res) => {
    const roomId = parseRoomId(req.params.roomId);
    const playerToken = bearer(req);
    const body = parse(actionSchema, req.body);
    res.json(store.submitAction({
      roomId,
      playerToken,
      expectedVersion: body.expectedVersion,
      action: body.action as JsonObject,
    }));
  });

  router.post('/rooms/:roomId/chat', requireJson, ...jsonBody, (req, res) => {
    const roomId = parseRoomId(req.params.roomId);
    const playerToken = bearer(req);
    const body = parse(chatSchema, req.body);
    res.json(store.sendChat({ roomId, playerToken, text: body.text }));
  });

  router.post('/rooms/:roomId/rematch', (req, res) => {
    res.json(store.requestRematch({
      roomId: parseRoomId(req.params.roomId),
      playerToken: bearer(req),
    }));
  });

  router.use((_req, res) => {
    sendError(res, 404, 'NOT_FOUND', 'No such playground API route.');
  });

  const handleError: ErrorRequestHandler = (error: unknown, _req, res, _next) => {
    if (res.headersSent) {
      res.end();
      return;
    }
    if (error instanceof RoomError) {
      sendError(res, roomStatus[error.code] ?? 400, error.code, error.message);
      return;
    }
    if (error instanceof InputError) {
      sendError(res, 400, 'INVALID_INPUT', 'Check the request fields and try again.');
      return;
    }
    if (error instanceof AuthError) {
      res.setHeader('WWW-Authenticate', 'Bearer');
      sendError(res, 401, 'UNAUTHORIZED', 'Use the private player token for this room.');
      return;
    }
    const type = (error as { type?: string } | null)?.type;
    if (type === 'entity.too.large') {
      sendError(res, 413, 'PAYLOAD_TOO_LARGE', 'The request body is too large.');
      return;
    }
    if (type === 'entity.parse.failed') {
      sendError(res, 400, 'INVALID_INPUT', 'Send a valid JSON object.');
      return;
    }
    sendError(res, 500, 'INTERNAL_ERROR', 'The playground could not complete that request.');
  };
  router.use(handleError);

  return router;
}
