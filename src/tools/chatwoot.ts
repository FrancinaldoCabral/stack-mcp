import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import { config } from '../config.js';
import { createClient, safeRequest, toText } from '../utils/http.js';

const client = () =>
  createClient(config.chatwoot.url, {
    api_access_token: config.chatwoot.apiKey,
    'Content-Type': 'application/json',
  });

const acct = () => `/api/v1/accounts/${config.chatwoot.accountId}`;

export const chatwootTools: Tool[] = [
  {
    name: 'chatwoot_list_conversations',
    description: 'Lista conversas do Chatwoot com filtros por status, inbox e agente.',
    inputSchema: {
      type: 'object',
      properties: {
        status: {
          type: 'string',
          enum: ['open', 'resolved', 'pending', 'snoozed', 'all'],
          description: 'Status das conversas',
        },
        inbox_id: { type: 'number', description: 'Filtrar por inbox' },
        assignee_type: {
          type: 'string',
          enum: ['me', 'unassigned', 'all'],
          description: 'Filtrar por tipo de atribuição',
        },
        page: { type: 'number', description: 'Página (padrão 1)' },
      },
    },
  },
  {
    name: 'chatwoot_get_conversation',
    description: 'Obtém detalhes completos de uma conversa, incluindo mensagens.',
    inputSchema: {
      type: 'object',
      required: ['id'],
      properties: { id: { type: 'number', description: 'ID da conversa' } },
    },
  },
  {
    name: 'chatwoot_send_message',
    description: 'Envia uma mensagem em uma conversa existente.',
    inputSchema: {
      type: 'object',
      required: ['conversation_id', 'content'],
      properties: {
        conversation_id: { type: 'number' },
        content: { type: 'string', description: 'Conteúdo da mensagem' },
        message_type: {
          type: 'string',
          enum: ['outgoing', 'note'],
          description: 'outgoing=mensagem ao cliente, note=nota privada',
        },
        private: { type: 'boolean', description: 'Nota privada (true) ou mensagem pública (false)' },
      },
    },
  },
  {
    name: 'chatwoot_assign_conversation',
    description: 'Atribui uma conversa a um agente ou equipe.',
    inputSchema: {
      type: 'object',
      required: ['conversation_id'],
      properties: {
        conversation_id: { type: 'number' },
        assignee_id: { type: 'number', description: 'ID do agente' },
        team_id: { type: 'number', description: 'ID da equipe' },
      },
    },
  },
  {
    name: 'chatwoot_update_conversation_status',
    description: 'Atualiza o status de uma conversa (abrir, resolver, etc).',
    inputSchema: {
      type: 'object',
      required: ['conversation_id', 'status'],
      properties: {
        conversation_id: { type: 'number' },
        status: { type: 'string', enum: ['open', 'resolved', 'pending', 'snoozed'] },
      },
    },
  },
  {
    name: 'chatwoot_list_contacts',
    description: 'Lista contatos do Chatwoot com suporte a busca.',
    inputSchema: {
      type: 'object',
      properties: {
        q: { type: 'string', description: 'Busca por nome, email ou telefone' },
        page: { type: 'number' },
      },
    },
  },
  {
    name: 'chatwoot_create_contact',
    description: 'Cria um novo contato no Chatwoot.',
    inputSchema: {
      type: 'object',
      required: ['name'],
      properties: {
        name: { type: 'string' },
        email: { type: 'string' },
        phone_number: { type: 'string', description: 'Com código do país: +5511999999999' },
        identifier: { type: 'string', description: 'Identificador único externo' },
        additional_attributes: { type: 'object', description: 'Atributos customizados' },
      },
    },
  },
  {
    name: 'chatwoot_list_inboxes',
    description: 'Lista todas as inboxes configuradas no Chatwoot.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'chatwoot_list_agents',
    description: 'Lista todos os agentes da conta Chatwoot.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'chatwoot_get_reports',
    description: 'Obtém relatórios de atendimento (conversas, resolução, CSAT).',
    inputSchema: {
      type: 'object',
      required: ['metric', 'type'],
      properties: {
        metric: {
          type: 'string',
          enum: ['account_conversations', 'account_incoming_messages_count', 'account_resolution_time'],
          description: 'Métrica desejada',
        },
        type: { type: 'string', enum: ['account', 'inbox', 'agent', 'team'] },
        id: { type: 'number', description: 'ID do inbox/agente/equipe (se type != account)' },
        since: { type: 'string', description: 'Data início Unix timestamp' },
        until: { type: 'string', description: 'Data fim Unix timestamp' },
      },
    },
  },
];

type Args = Record<string, unknown>;

export async function handleChatwootTool(name: string, args: Args): Promise<string> {
  const http = client();
  const base = acct();

  switch (name) {
    case 'chatwoot_list_conversations': {
      const params: Record<string, unknown> = { page: args.page ?? 1 };
      if (args.status) params.status = args.status;
      if (args.inbox_id) params.inbox_id = args.inbox_id;
      if (args.assignee_type) params.assignee_type = args.assignee_type;
      const res = await safeRequest(() => http.get(`${base}/conversations`, { params }).then(r => r.data));
      return toText(res);
    }
    case 'chatwoot_get_conversation': {
      const res = await safeRequest(() =>
        http.get(`${base}/conversations/${args.id}`).then(r => r.data)
      );
      return toText(res);
    }
    case 'chatwoot_send_message': {
      const payload = {
        content: args.content,
        message_type: args.message_type ?? 'outgoing',
        private: args.private ?? false,
      };
      const res = await safeRequest(() =>
        http.post(`${base}/conversations/${args.conversation_id}/messages`, payload).then(r => r.data)
      );
      return toText(res);
    }
    case 'chatwoot_assign_conversation': {
      const payload: Record<string, unknown> = {};
      if (args.assignee_id) payload.assignee_id = args.assignee_id;
      if (args.team_id) payload.team_id = args.team_id;
      const res = await safeRequest(() =>
        http.patch(`${base}/conversations/${args.conversation_id}/assignments`, payload).then(r => r.data)
      );
      return toText(res);
    }
    case 'chatwoot_update_conversation_status': {
      const res = await safeRequest(() =>
        http
          .patch(`${base}/conversations/${args.conversation_id}`, { status: args.status })
          .then(r => r.data)
      );
      return toText(res);
    }
    case 'chatwoot_list_contacts': {
      const params: Record<string, unknown> = { page: args.page ?? 1 };
      if (args.q) params.q = args.q;
      const res = await safeRequest(() => http.get(`${base}/contacts`, { params }).then(r => r.data));
      return toText(res);
    }
    case 'chatwoot_create_contact': {
      const res = await safeRequest(() => http.post(`${base}/contacts`, args).then(r => r.data));
      return toText(res);
    }
    case 'chatwoot_list_inboxes': {
      const res = await safeRequest(() => http.get(`${base}/inboxes`).then(r => r.data));
      return toText(res);
    }
    case 'chatwoot_list_agents': {
      const res = await safeRequest(() => http.get(`${base}/agents`).then(r => r.data));
      return toText(res);
    }
    case 'chatwoot_get_reports': {
      const params: Record<string, unknown> = { metric: args.metric, type: args.type };
      if (args.id) params.id = args.id;
      if (args.since) params.since = args.since;
      if (args.until) params.until = args.until;
      const res = await safeRequest(() =>
        http.get(`${base}/reports/agents/summary`, { params }).then(r => r.data)
      );
      return toText(res);
    }
    default:
      return `❌ Ferramenta desconhecida: ${name}`;
  }
}
