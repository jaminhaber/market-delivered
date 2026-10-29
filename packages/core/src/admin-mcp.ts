import { createHash } from 'node:crypto';
import { and, eq, gt, isNull } from 'drizzle-orm';
import * as s from '@market/db';
import { z } from 'zod';
import type { FastifyInstance } from 'fastify';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import {
  networkInput,
  networkSettingsInput,
  membershipInput,
  networkOperations,
  permissions,
  resolveNetwork,
} from './networks.js';
import { operations } from './operations.js';

export function registerAdminMcp(
  server: FastifyInstance,
  db: s.Database,
  config: { networkSecret: string; production?: boolean },
) {
  server.route({
    method: ['GET', 'POST', 'DELETE'],
    url: '/mcp',
    async handler(request, reply) {
      reply.header('Cache-Control', 'no-store');
      const header = request.headers.authorization;
      if (!header?.startsWith('Bearer '))
        return reply
          .header('WWW-Authenticate', 'Bearer realm="market-platform"')
          .code(401)
          .send({ error: 'A global administrator token is required' });
      const [token] = await db
        .select()
        .from(s.apiTokens)
        .where(
          and(
            eq(
              s.apiTokens.tokenHash,
              createHash('sha256').update(header.slice(7)).digest('hex'),
            ),
            isNull(s.apiTokens.networkId),
            isNull(s.apiTokens.revokedAt),
            gt(s.apiTokens.expiresAt, new Date()),
          ),
        );
      if (!token || !(await permissions(db, token.userId)).globalAdmin)
        return reply
          .code(401)
          .send({ error: 'Invalid, expired, or revoked global token' });
      if (request.method !== 'POST')
        return reply
          .header('Allow', 'POST')
          .code(405)
          .send({ error: 'Use POST for stateless MCP' });
      const [person] = await db
        .select()
        .from(s.user)
        .where(eq(s.user.id, token.userId));
      if (!person)
        return reply.code(401).send({ error: 'Invalid token owner' });
      const actor = {
        id: person.id,
        name: person.name,
        email: person.email,
        globalAdmin: true,
        networkAdmin: true,
        admin: true,
      };
      const ops = (networkId: string | null = null) =>
        networkOperations(db, actor, networkId, config.networkSecret);
      const mcp = new McpServer({
        name: 'market-delivered-platform',
        version: '3.0.0',
      });
      const call = async (fn: () => Promise<unknown>) => {
        try {
          return {
            content: [
              { type: 'text' as const, text: JSON.stringify(await fn()) },
            ],
          };
        } catch (error) {
          return {
            content: [
              {
                type: 'text' as const,
                text: JSON.stringify({
                  error:
                    error instanceof Error && 'code' in error
                      ? error.message
                      : 'Operation failed',
                }),
              },
            ],
            isError: true,
          };
        }
      };
      const readOnly = { readOnlyHint: true, destructiveHint: false };
      const id = z.object({ networkId: z.uuid() });
      function validateOrigin(origin?: string) {
        if (
          config.production &&
          origin &&
          new URL(origin).protocol !== 'https:'
        )
          throw new Error('Production frontends require HTTPS');
      }
      mcp.registerTool(
        'list_networks',
        {
          description:
            'List delivery networks and their registered frontend origins.',
          inputSchema: {},
          annotations: readOnly,
        },
        () => call(() => ops().list()),
      );
      mcp.registerTool(
        'create_network',
        {
          description:
            'Create an independent delivery network. Register its own frontendOrigin to enable browser authentication and email links.',
          inputSchema: networkInput,
        },
        (input) =>
          call(() => {
            validateOrigin(input.frontendOrigin);
            return ops().create(input);
          }),
      );
      mcp.registerTool(
        'get_network',
        {
          description:
            'Read platform settings for an explicit network. Email credentials are never returned.',
          inputSchema: id,
          annotations: readOnly,
        },
        (input) => call(() => ops(input.networkId).get()),
      );
      mcp.registerTool(
        'update_network',
        {
          description:
            'Update an explicit network’s frontend origin, email identity, support, and location settings. Email keys are encrypted and write-only.',
          inputSchema: z.object({
            ...id.shape,
            settings: networkSettingsInput,
          }),
        },
        (input) =>
          call(() => {
            validateOrigin(input.settings.frontendOrigin);
            return ops(input.networkId).update(input.settings);
          }),
      );
      mcp.registerTool(
        'list_network_members',
        {
          description:
            'List a network’s members and local administrator roles.',
          inputSchema: id,
          annotations: readOnly,
        },
        (input) => call(() => ops(input.networkId).members()),
      );
      mcp.registerTool(
        'set_network_member',
        {
          description:
            'Assign an existing account to a network as member or network_admin. Does not grant global administrator access.',
          inputSchema: z.object({ ...id.shape, ...membershipInput.shape }),
        },
        (input) => call(() => ops(input.networkId).setMember(input)),
      );
      mcp.registerTool(
        'create_network_token',
        {
          description:
            'Issue a business MCP token bound to one network. The token cannot access this platform endpoint. The secret is returned only once.',
          inputSchema: z.object({
            ...id.shape,
            name: z.string().trim().min(2).max(100),
          }),
        },
        (input) =>
          call(async () => {
            const network = await resolveNetwork(db, input.networkId);
            return operations(
              s.networkDatabase(db, network.id, actor.id),
              actor,
            ).createApiToken(input.name);
          }),
      );
      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: undefined,
        enableJsonResponse: true,
      });
      reply.hijack();
      reply.raw.on('close', () => {
        void transport.close();
        void mcp.close();
      });
      await mcp.connect(transport);
      await transport.handleRequest(request.raw, reply.raw, request.body);
    },
  });
}
