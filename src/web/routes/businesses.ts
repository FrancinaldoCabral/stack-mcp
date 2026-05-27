import { Router } from 'express';
import { ObjectId } from 'mongodb';
import { randomUUID } from 'crypto';
import axios from 'axios';
import { getDb } from '../../tools/mongodb.js';
import { getRedis } from '../../tools/redis.js';
import { config } from '../../config.js';
import { sendQrLinkEmail } from '../email.js';

export const businessesRouter = Router();

// ── helper: provisiona apenas Chatwoot (sem Evolution) ───────────────────────
async function provisionChatwoot(bizId: ObjectId, bizName: string, db: Awaited<ReturnType<typeof getDb>>) {
  const inboxName = `${bizName} - WhatsApp`;
  const chatwootRes = await axios.post(
    `${config.chatwoot.url}/api/v1/accounts/${config.chatwoot.accountId}/inboxes`,
    { name: inboxName, channel: { type: 'api', webhook_url: '' } },
    { headers: { api_access_token: config.chatwoot.apiKey }, timeout: 12_000 },
  );
  const chatwootInboxId = chatwootRes.data.id as number;

  // Webhook conta Chatwoot → N8N (idempotente)
  const handoffWebhookUrl = `${config.n8n.url}/webhook/chatwoot-events`;
  try {
    const listRes = await axios.get(
      `${config.chatwoot.url}/api/v1/accounts/${config.chatwoot.accountId}/integrations/webhooks`,
      { headers: { api_access_token: config.chatwoot.apiKey }, timeout: 8_000 },
    );
    const existing = (listRes.data?.payload ?? []) as { url: string }[];
    if (!existing.some(w => w.url === handoffWebhookUrl)) {
      await axios.post(
        `${config.chatwoot.url}/api/v1/accounts/${config.chatwoot.accountId}/integrations/webhooks`,
        { url: handoffWebhookUrl, subscriptions: ['message_created', 'conversation_status_changed'] },
        { headers: { api_access_token: config.chatwoot.apiKey }, timeout: 8_000 },
      );
    }
  } catch (_) { /* webhook opcional */ }

  await db.collection('businesses').updateOne(
    { _id: bizId },
    { $set: { chatwootInboxId, updatedAt: new Date() } },
  );
  return chatwootInboxId;
}

// GET /api/businesses
businessesRouter.get('/', async (_req, res) => {
  try {
    const db = await getDb();
    const docs = await db.collection('businesses').find({}).sort({ createdAt: -1 }).toArray();
    res.json(docs);
  } catch (e) { res.status(500).json({ error: String(e) }); }
});

// GET /api/businesses/:id
businessesRouter.get('/:id', async (req, res) => {
  try {
    const db = await getDb();
    const doc = await db.collection('businesses').findOne({ _id: new ObjectId(req.params.id) });
    if (!doc) return res.status(404).json({ error: 'Not found' });
    res.json(doc);
  } catch (e) { res.status(500).json({ error: String(e) }); }
});

// POST /api/businesses — cria negócio e provisiona Chatwoot automaticamente
businessesRouter.post('/', async (req, res) => {
  try {
    const db = await getDb();
    const now = new Date();
    const doc = {
      name: String(req.body.name ?? ''),
      instances: [] as string[],
      assistantName: String(req.body.assistantName ?? 'Assistente'),
      systemPrompt: String(req.body.systemPrompt ?? ''),
      settings: {
        model: req.body.settings?.model ?? 'google/gemini-2.5-flash-preview',
        maxHistoryTokens: Number(req.body.settings?.maxHistoryTokens ?? 500_000),
        tools: { searchMemory: req.body.settings?.tools?.searchMemory ?? true },
      },
      createdAt: now,
      updatedAt: now,
    };
    const result = await db.collection('businesses').insertOne(doc);
    const bizId = result.insertedId;
    res.status(201).json({ ...doc, _id: bizId });
  } catch (e) { res.status(500).json({ error: String(e) }); }
});

// PUT /api/businesses/:id
businessesRouter.put('/:id', async (req, res) => {
  try {
    const db = await getDb();
    const update: Record<string, unknown> = { updatedAt: new Date() };
    if (req.body.name !== undefined) update.name = req.body.name;
    if (req.body.instances !== undefined) update.instances = req.body.instances;
    if (req.body.assistantName !== undefined) update.assistantName = req.body.assistantName;
    if (req.body.systemPrompt !== undefined) update.systemPrompt = req.body.systemPrompt;
    if (req.body.settings !== undefined) update.settings = req.body.settings;
    const result = await db.collection('businesses').findOneAndUpdate(
      { _id: new ObjectId(req.params.id) },
      { $set: update },
      { returnDocument: 'after' }
    );
    if (!result) return res.status(404).json({ error: 'Not found' });
    res.json(result);
  } catch (e) { res.status(500).json({ error: String(e) }); }
});

// DELETE /api/businesses/:id — remove negócio + Evolution + Chatwoot + dados relacionados
businessesRouter.delete('/:id', async (req, res) => {
  try {
    const db = await getDb();
    const business = await db.collection('businesses').findOne({ _id: new ObjectId(req.params.id) });
    if (!business) return res.status(404).json({ error: 'Not found' });

    // 1. Deletar instâncias Evolution
    const instances: string[] = (business.instances as string[]) ?? [];
    for (const iName of instances) {
      try {
        await axios.delete(`${config.evolution.url}/instance/delete/${iName}`, {
          headers: { apikey: config.evolution.apiKey },
          timeout: 10_000,
        });
      } catch (_) { /* ignora erro — instância pode não existir mais */ }
    }

    // 2. Deletar inboxes Chatwoot (uma por instância)
    const instanceInboxes: Record<string, number> = (business.instanceInboxes as Record<string, number>) ?? {};
    const inboxIdsToDelete = new Set(Object.values(instanceInboxes));
    // Compatibilidade com campo legado chatwootInboxId
    if (business.chatwootInboxId) inboxIdsToDelete.add(business.chatwootInboxId as number);
    for (const inboxId of inboxIdsToDelete) {
      try {
        await axios.delete(
          `${config.chatwoot.url}/api/v1/accounts/${config.chatwoot.accountId}/inboxes/${inboxId}`,
          { headers: { api_access_token: config.chatwoot.apiKey }, timeout: 10_000 },
        );
      } catch (_) { /* ignora */ }
    }

    // 3. Limpar dados relacionados no MongoDB
    const bizId = new ObjectId(req.params.id);
    await Promise.all([
      db.collection('conversations').deleteMany({ businessId: bizId }),
      db.collection('customers').deleteMany({ businessId: bizId }),
    ]);

    // 4. Deletar Redis (sessões, buffers, debounce)
    try {
      const redis = await getRedis();
      const patterns = instances.flatMap(i => [
        `sessao:${i}:*`, `buffer:${i}:*`, `debounce_ts:${i}:*`,
      ]);
      for (const pattern of patterns) {
        let cursor = '0';
        do {
          const [next, keys] = await redis.scan(cursor, 'MATCH', pattern, 'COUNT', 200);
          cursor = next;
          if (keys.length) await redis.del(...keys);
        } while (cursor !== '0');
      }
    } catch (_) { /* Redis opcional */ }

    // 5. Deletar o negócio
    await db.collection('businesses').deleteOne({ _id: bizId });
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: String(e) }); }
});

// POST /api/businesses/:id/add-instance — adiciona conta WhatsApp ao negócio
businessesRouter.post('/:id/add-instance', async (req, res) => {
  try {
    const { instanceName } = req.body as { instanceName?: string };
    if (!instanceName?.trim()) return res.status(400).json({ error: 'instanceName é obrigatório' });

    const db = await getDb();
    const business = await db.collection('businesses').findOne({ _id: new ObjectId(req.params.id) });
    if (!business) return res.status(404).json({ error: 'Negócio não encontrado' });

    const iName = instanceName.trim();

    // Criar instância Evolution — ignora se já existir (403 = already in use)
    try {
      await axios.post(
        `${config.evolution.url}/instance/create`,
        {
          instanceName: iName,
          qrcode: true,
          integration: 'WHATSAPP-BAILEYS',
          webhook: {
            enabled: true,
            url: `${config.n8n.url}/webhook/evolution`,
            webhook_by_events: false,
            webhook_base64: false,
            events: ['MESSAGES_UPSERT'],
          },
        },
        { headers: { apikey: config.evolution.apiKey }, timeout: 15_000 },
      );
    } catch (createErr) {
      const status = (createErr as { response?: { status?: number } }).response?.status;
      if (status !== 403) throw createErr; // 403 = já existe, continua; outros erros propagam
    }

    // Webhook Evolution → N8N
    await axios.post(
      `${config.evolution.url}/webhook/set/${iName}`,
      {
        webhook: {
          enabled: true,
          url: `${config.n8n.url}/webhook/evolution`,
          webhook_by_events: false,
          webhook_base64: false,
          events: ['MESSAGES_UPSERT'],
        },
      },
      { headers: { apikey: config.evolution.apiKey }, timeout: 10_000 },
    );

    // Integração nativa Evolution → Chatwoot (autoCreate cria a inbox automaticamente)
    let instanceChatwootInboxId: number | undefined;
    try {
      await axios.post(
        `${config.evolution.url}/chatwoot/set/${iName}`,
        {
          enabled: true,
          accountId: String(config.chatwoot.accountId),
          token: config.chatwoot.apiKey,
          url: config.chatwoot.url,
          signMsg: false,
          reopenConversation: true,
          conversationPending: false,
          nameInbox: iName,
          mergeBrazilContacts: false,
          importContacts: false,
          importMessages: false,
          daysLimitImportMessages: 0,
          signDelimiter: '\n',
          autoCreate: true,
          organization: '',
          logo: '',
          ignoreJids: [],
        },
        { headers: { apikey: config.evolution.apiKey }, timeout: 12_000 },
      );

      // Buscar inbox criada pela Evolution para guardar o ID
      const inboxesRes = await axios.get(
        `${config.chatwoot.url}/api/v1/accounts/${config.chatwoot.accountId}/inboxes`,
        { headers: { api_access_token: config.chatwoot.apiKey }, timeout: 8_000 },
      );
      const inboxes = (inboxesRes.data?.payload ?? []) as { id: number; name: string }[];
      const inbox = inboxes.find(i => i.name === iName);
      if (inbox) {
        instanceChatwootInboxId = inbox.id;
        // Atribuir Agent Bot Vendly AI à inbox (silencioso se bot não existir)
        try { await assignVendlyBotToInbox(inbox.id); } catch (_) { /* opcional */ }
      }

      // Garantir webhook de conta Chatwoot → N8N (idempotente)
      const handoffUrl = `${config.n8n.url}/webhook/chatwoot-events`;
      try {
        const listRes = await axios.get(
          `${config.chatwoot.url}/api/v1/accounts/${config.chatwoot.accountId}/integrations/webhooks`,
          { headers: { api_access_token: config.chatwoot.apiKey }, timeout: 8_000 },
        );
        const existing = (listRes.data?.payload ?? []) as { url: string }[];
        if (!existing.some(w => w.url === handoffUrl)) {
          await axios.post(
            `${config.chatwoot.url}/api/v1/accounts/${config.chatwoot.accountId}/integrations/webhooks`,
            { url: handoffUrl, subscriptions: ['message_created', 'conversation_status_changed'] },
            { headers: { api_access_token: config.chatwoot.apiKey }, timeout: 8_000 },
          );
        }
      } catch (_) { /* webhook opcional */ }
    } catch (_) { /* Chatwoot falha silenciosa */ }

    const existingInstances: string[] = (business.instances as string[]) ?? [];
    const instances = Array.from(new Set([...existingInstances, iName]));
    const existingInboxes: Record<string, number> = (business.instanceInboxes as Record<string, number>) ?? {};
    if (instanceChatwootInboxId) existingInboxes[iName] = instanceChatwootInboxId;

    const updated = await db.collection('businesses').findOneAndUpdate(
      { _id: new ObjectId(req.params.id) },
      { $set: { instances, instanceInboxes: existingInboxes, updatedAt: new Date() } },
      { returnDocument: 'after' },
    );
    // Propagar filtro de contatos (se houver) para a nova instância no Redis
    if (updated) {
      const filter = sanitizeFilter(updated.contactFilter as Partial<ContactFilter> | undefined);
      await syncFilterToRedis([iName], filter);
    }
    res.json(updated);
  } catch (e) {
    const err = e as { response?: { data?: unknown }; message?: string };
    const detail = err.response?.data ?? err.message ?? String(e);
    res.status(500).json({ error: typeof detail === 'string' ? detail : JSON.stringify(detail) });
  }
});

// POST /api/businesses/:id/retry-chatwoot — retentar Chatwoot se falhou no create
businessesRouter.post('/:id/retry-chatwoot', async (req, res) => {
  try {
    const db = await getDb();
    const business = await db.collection('businesses').findOne({ _id: new ObjectId(req.params.id) });
    if (!business) return res.status(404).json({ error: 'Negócio não encontrado' });
    const chatwootInboxId = await provisionChatwoot(new ObjectId(req.params.id), business.name as string, db);
    res.json({ ok: true, chatwootInboxId });
  } catch (e) {
    const err = e as { response?: { data?: unknown }; message?: string };
    const detail = err.response?.data ?? err.message ?? String(e);
    res.status(500).json({ error: typeof detail === 'string' ? detail : JSON.stringify(detail) });
  }
});

// POST /api/businesses/:id/provision — mantido para MCP tools (compat)
businessesRouter.post('/:id/provision', async (req, res) => {
  try {
    const { instanceName } = req.body as { instanceName?: string };
    if (!instanceName?.trim()) return res.status(400).json({ error: 'instanceName é obrigatório' });

    const db = await getDb();
    const business = await db.collection('businesses').findOne({ _id: new ObjectId(req.params.id) });
    if (!business) return res.status(404).json({ error: 'Negócio não encontrado' });

    const iName = instanceName.trim();
    const inboxName = `${business.name} - WhatsApp`;

    // 1. Criar inbox no Chatwoot
    const chatwootInboxRes = await axios.post(
      `${config.chatwoot.url}/api/v1/accounts/${config.chatwoot.accountId}/inboxes`,
      { name: inboxName, channel: { type: 'api', webhook_url: '' } },
      { headers: { api_access_token: config.chatwoot.apiKey } },
    );
    const chatwootInboxId = chatwootInboxRes.data.id as number;

    // 2. Criar instância Evolution com integração Chatwoot
    await axios.post(
      `${config.evolution.url}/instance/create`,
      {
        instanceName: iName,
        qrcode: true,
        integration: 'WHATSAPP-BAILEYS',
        webhook: {
          enabled: true,
          url: `${config.n8n.url}/webhook/evolution`,
          webhook_by_events: false,
          webhook_base64: false,
          events: ['MESSAGES_UPSERT'],
        },
      },
      { headers: { apikey: config.evolution.apiKey } },
    );

    // 3. Configurar webhook Evolution → N8N
    await axios.post(
      `${config.evolution.url}/webhook/set/${iName}`,
      {
        webhook: {
          enabled: true,
          url: `${config.n8n.url}/webhook/evolution`,
          webhook_by_events: false,
          webhook_base64: false,
          events: ['MESSAGES_UPSERT'],
        },
      },
      { headers: { apikey: config.evolution.apiKey } },
    );

    // 4. Garantir webhook de conta no Chatwoot (idempotente)
    const handoffWebhookUrl = `${config.n8n.url}/webhook/chatwoot-events`;
    try {
      const listRes = await axios.get(
        `${config.chatwoot.url}/api/v1/accounts/${config.chatwoot.accountId}/integrations/webhooks`,
        { headers: { api_access_token: config.chatwoot.apiKey } },
      );
      const existing = (listRes.data?.payload ?? []) as { url: string }[];
      const alreadySet = existing.some(w => w.url === handoffWebhookUrl);
      if (!alreadySet) {
        await axios.post(
          `${config.chatwoot.url}/api/v1/accounts/${config.chatwoot.accountId}/integrations/webhooks`,
          { url: handoffWebhookUrl, subscriptions: ['message_created', 'conversation_status_changed'] },
          { headers: { api_access_token: config.chatwoot.apiKey } },
        );
      }
    } catch (_webhookErr) {
      // webhook de conta é opcional — não falhar o provision por isso
    }

    // 5. Atualizar negócio no MongoDB
    const existingInstances: string[] = (business.instances as string[]) ?? [];
    const instances = Array.from(new Set([...existingInstances, iName]));
    const updated = await db.collection('businesses').findOneAndUpdate(
      { _id: new ObjectId(req.params.id) },
      { $set: { instances, chatwootInboxId, updatedAt: new Date() } },
      { returnDocument: 'after' },
    );

    res.json(updated);
  } catch (e) {
    const err = e as { response?: { data?: unknown }; message?: string };
    const detail = err.response?.data ?? err.message ?? String(e);
    res.status(500).json({ error: typeof detail === 'string' ? detail : JSON.stringify(detail) });
  }
});

// GET /api/businesses/:id/instances-status — status de todas as instâncias
businessesRouter.get('/:id/instances-status', async (req, res) => {
  try {
    const db = await getDb();
    const business = await db.collection('businesses').findOne({ _id: new ObjectId(req.params.id) });
    if (!business) return res.status(404).json({ error: 'Not found' });
    const instances: string[] = (business.instances as string[]) ?? [];
    const instanceInboxes: Record<string, number> = (business.instanceInboxes as Record<string, number>) ?? {};
    const statuses = await Promise.all(
      instances.map(async (name) => {
        try {
          const r = await axios.get(`${config.evolution.url}/instance/connectionState/${name}`, {
            headers: { apikey: config.evolution.apiKey },
            timeout: 5_000,
          });
          const state: string = r.data?.instance?.state ?? r.data?.state ?? 'unknown';
          return { instanceName: name, status: state, inboxId: instanceInboxes[name] ?? null };
        } catch {
          return { instanceName: name, status: 'unknown', inboxId: instanceInboxes[name] ?? null };
        }
      }),
    );
    res.json(statuses);
  } catch (e) { res.status(500).json({ error: String(e) }); }
});

// POST /api/businesses/:id/instances/:name/disconnect — logout WhatsApp
businessesRouter.post('/:id/instances/:name/disconnect', async (req, res) => {
  try {
    await axios.delete(`${config.evolution.url}/instance/logout/${req.params.name}`, {
      headers: { apikey: config.evolution.apiKey },
      timeout: 10_000,
    });
    res.json({ ok: true });
  } catch (e) {
    const err = e as { response?: { data?: unknown }; message?: string };
    const detail = err.response?.data ?? err.message ?? String(e);
    res.status(500).json({ error: typeof detail === 'string' ? detail : JSON.stringify(detail) });
  }
});

// GET /api/businesses/:id/qr — admin: fetch QR code from Evolution
businessesRouter.get('/:id/qr', async (req, res) => {
  try {
    const db = await getDb();
    const business = await db.collection('businesses').findOne({ _id: new ObjectId(req.params.id) });
    if (!business?.instances?.length) return res.status(404).json({ error: 'Nenhuma instância configurada' });
    const instanceName = (req.query.instance as string) || (business.instances as string[])[0];
    const r = await axios.get(`${config.evolution.url}/instance/connect/${instanceName}`, {
      headers: { apikey: config.evolution.apiKey },
    });
    res.json({ base64: r.data?.base64 ?? null, code: r.data?.code ?? null, instanceName });
  } catch (e) {
    const err = e as { response?: { data?: unknown }; message?: string };
    const detail = err.response?.data ?? err.message ?? String(e);
    res.status(500).json({ error: typeof detail === 'string' ? detail : JSON.stringify(detail) });
  }
});

// GET /api/businesses/:id/qr-status — admin: check connection state
businessesRouter.get('/:id/qr-status', async (req, res) => {
  try {
    const db = await getDb();
    const business = await db.collection('businesses').findOne({ _id: new ObjectId(req.params.id) });
    if (!business?.instances?.length) return res.status(404).json({ error: 'Nenhuma instância configurada' });
    const instanceName = (req.query.instance as string) || (business.instances as string[])[0];
    const r = await axios.get(`${config.evolution.url}/instance/connectionState/${instanceName}`, {
      headers: { apikey: config.evolution.apiKey },
    });
    const state: string = r.data?.instance?.state ?? r.data?.state ?? 'unknown';
    res.json({ status: state, instanceName });
  } catch {
    res.json({ status: 'unknown' });
  }
});

// POST /api/businesses/:id/qr-link — gerar link de conexão + email opcional
businessesRouter.post('/:id/qr-link', async (req, res) => {
  try {
    const { email, instanceName: reqInst } = req.body as { email?: string; instanceName?: string };

    const db = await getDb();
    const business = await db.collection('businesses').findOne({ _id: new ObjectId(req.params.id) });
    if (!business?.instances?.length) return res.status(400).json({ error: 'Negócio não está provisionado' });

    const instanceName = reqInst?.trim() || (business.instances as string[])[0];
    const token = randomUUID();
    const ttl = 86_400; // 24h

    const redis = getRedis();
    await redis.set(
      `qr_link:${token}`,
      JSON.stringify({ instanceName, businessName: business.name }),
      'EX',
      ttl,
    );

    const protocol = (req.get('x-forwarded-proto') ?? req.protocol) as string;
    const host = req.get('host') ?? 'localhost';
    const connectUrl = `${protocol}://${host}/connect/${token}`;

    if (email?.trim()) {
      await sendQrLinkEmail(email.trim(), connectUrl, business.name as string);
    }
    res.json({ ok: true, connectUrl });
  } catch (e) {
    const err = e as { response?: { data?: unknown }; message?: string };
    const detail = err.response?.data ?? err.message ?? String(e);
    res.status(500).json({ error: typeof detail === 'string' ? detail : JSON.stringify(detail) });
  }
});

// ── Agentes ───────────────────────────────────────────────────────────────────

type AgentDoc = {
  _id: string;
  name: string;
  assistantName: string;
  systemPrompt: string;
  model: string;
  settings: { maxHistoryTokens: number; tools: { searchMemory: boolean } };
  createdAt: Date;
  updatedAt: Date;
};

async function syncAgentToRedis(instanceName: string, agent: AgentDoc | null) {
  try {
    const redis = getRedis();
    const key = `agente:${instanceName}`;
    if (agent) {
      await redis.set(key, JSON.stringify({
        systemPrompt: agent.systemPrompt,
        assistantName: agent.assistantName,
        model: agent.model,
        maxHistoryTokens: agent.settings.maxHistoryTokens,
        tools: agent.settings.tools,
      }));
    } else {
      await redis.del(key);
    }
  } catch (_) { /* Redis sync opcional */ }
}

// POST /api/businesses/:id/agents — criar agente
businessesRouter.post('/:id/agents', async (req, res) => {
  try {
    const db = await getDb();
    const agent: AgentDoc = {
      _id: randomUUID(),
      name: String(req.body.name ?? 'Agente'),
      assistantName: String(req.body.assistantName ?? 'Assistente'),
      systemPrompt: String(req.body.systemPrompt ?? ''),
      model: String(req.body.model ?? 'google/gemini-2.5-flash-lite'),
      settings: {
        maxHistoryTokens: Number(req.body.settings?.maxHistoryTokens ?? 500_000),
        tools: { searchMemory: req.body.settings?.tools?.searchMemory ?? true },
      },
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    const updated = await db.collection('businesses').findOneAndUpdate(
      { _id: new ObjectId(req.params.id) },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      { $push: { agents: agent } as any, $set: { updatedAt: new Date() } },
      { returnDocument: 'after' },
    );
    if (!updated) return res.status(404).json({ error: 'Not found' });
    res.status(201).json(updated);
  } catch (e) { res.status(500).json({ error: String(e) }); }
});

// PUT /api/businesses/:id/agents/:agentId — atualizar agente
businessesRouter.put('/:id/agents/:agentId', async (req, res) => {
  try {
    const db = await getDb();
    const { agentId } = req.params;
    const fields: Record<string, unknown> = { 'agents.$.updatedAt': new Date(), updatedAt: new Date() };
    if (req.body.name !== undefined) fields['agents.$.name'] = req.body.name;
    if (req.body.assistantName !== undefined) fields['agents.$.assistantName'] = req.body.assistantName;
    if (req.body.systemPrompt !== undefined) fields['agents.$.systemPrompt'] = req.body.systemPrompt;
    if (req.body.model !== undefined) fields['agents.$.model'] = req.body.model;
    if (req.body.settings !== undefined) fields['agents.$.settings'] = req.body.settings;

    const updated = await db.collection('businesses').findOneAndUpdate(
      { _id: new ObjectId(req.params.id), 'agents._id': agentId },
      { $set: fields },
      { returnDocument: 'after' },
    );
    if (!updated) return res.status(404).json({ error: 'Not found' });

    // Sincroniza Redis para todas as instâncias que usam este agente
    const instanceAgents = (updated.instanceAgents as Record<string, string>) ?? {};
    const agents = (updated.agents as AgentDoc[]) ?? [];
    const agent = agents.find(a => a._id === agentId);
    if (agent) {
      const assigned = Object.entries(instanceAgents).filter(([, aid]) => aid === agentId).map(([inst]) => inst);
      await Promise.all(assigned.map(inst => syncAgentToRedis(inst, agent)));
    }
    res.json(updated);
  } catch (e) { res.status(500).json({ error: String(e) }); }
});

// DELETE /api/businesses/:id/agents/:agentId — remover agente
businessesRouter.delete('/:id/agents/:agentId', async (req, res) => {
  try {
    const db = await getDb();
    const { agentId } = req.params;
    const business = await db.collection('businesses').findOne({ _id: new ObjectId(req.params.id) });
    if (!business) return res.status(404).json({ error: 'Not found' });

    const instanceAgents = (business.instanceAgents as Record<string, string>) ?? {};
    const affected = Object.entries(instanceAgents).filter(([, aid]) => aid === agentId).map(([inst]) => inst);
    const newInstanceAgents = Object.fromEntries(Object.entries(instanceAgents).filter(([, aid]) => aid !== agentId));

    const updated = await db.collection('businesses').findOneAndUpdate(
      { _id: new ObjectId(req.params.id) },
      {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        $pull: { agents: { _id: agentId } } as any,
        $set: { instanceAgents: newInstanceAgents, updatedAt: new Date() },
      },
      { returnDocument: 'after' },
    );
    if (!updated) return res.status(404).json({ error: 'Not found' });
    await Promise.all(affected.map(inst => syncAgentToRedis(inst, null)));
    res.json(updated);
  } catch (e) { res.status(500).json({ error: String(e) }); }
});

// ── Chatwoot Agent Bot helpers ────────────────────────────────────────────────

/** Busca o ID do Agent Bot 'Vendly AI' no Chatwoot. Retorna null se não encontrado. */
async function findVendlyAgentBotId(): Promise<number | null> {
  try {
    const res = await axios.get(
      `${config.chatwoot.url}/api/v1/accounts/${config.chatwoot.accountId}/agent_bots`,
      { headers: { api_access_token: config.chatwoot.apiKey }, timeout: 8_000 },
    );
    const bots = (res.data ?? []) as { id: number; name: string; outgoing_url?: string }[];
    const bot = bots.find(b => b.name === 'Vendly AI');
    return bot?.id ?? null;
  } catch { return null; }
}

/** Atribui o Agent Bot Vendly AI à inbox. Retorna o ID do bot ou null se não encontrado. */
async function assignVendlyBotToInbox(inboxId: number): Promise<number | null> {
  const botId = await findVendlyAgentBotId();
  if (!botId) return null;
  await axios.post(
    `${config.chatwoot.url}/api/v1/accounts/${config.chatwoot.accountId}/inboxes/${inboxId}/set_agent_bot`,
    { agent_bot: botId },
    { headers: { api_access_token: config.chatwoot.apiKey }, timeout: 8_000 },
  );
  return botId;
}

// POST /api/businesses/:id/instances/:name/set-agent-bot — ativar/desativar Agent Bot Chatwoot
businessesRouter.post('/:id/instances/:name/set-agent-bot', async (req, res) => {
  try {
    const { name: instanceName } = req.params;
    const { enable = true } = req.body as { enable?: boolean };

    const db = await getDb();
    const business = await db.collection('businesses').findOne({ _id: new ObjectId(req.params.id) });
    if (!business) return res.status(404).json({ error: 'Negócio não encontrado' });

    const instanceInboxes = (business.instanceInboxes as Record<string, number>) ?? {};
    const inboxId = instanceInboxes[instanceName];
    if (!inboxId) return res.status(400).json({ error: `Inbox não encontrada para instância "${instanceName}". Configure o Chatwoot primeiro.` });

    if (enable) {
      const botId = await assignVendlyBotToInbox(inboxId);
      if (!botId) return res.status(404).json({ error: 'Agent Bot "Vendly AI" não encontrado no Chatwoot. Execute setup-chatwoot-first.mjs primeiro.' });
      ok(`Agent Bot (ID=${botId}) atribuído à inbox ${inboxId} (${instanceName})`);
      res.json({ ok: true, botEnabled: true, inboxId, botId });
    } else {
      // Remove Agent Bot da inbox
      await axios.post(
        `${config.chatwoot.url}/api/v1/accounts/${config.chatwoot.accountId}/inboxes/${inboxId}/set_agent_bot`,
        { agent_bot: null },
        { headers: { api_access_token: config.chatwoot.apiKey }, timeout: 8_000 },
      );
      res.json({ ok: true, botEnabled: false, inboxId });
    }
  } catch (e) {
    const err = e as { response?: { data?: unknown }; message?: string };
    const detail = err.response?.data ?? err.message ?? String(e);
    res.status(500).json({ error: typeof detail === 'string' ? detail : JSON.stringify(detail) });
  }
});

// GET /api/businesses/:id/instances/:name/chatwoot-status — status Chatwoot da instância
businessesRouter.get('/:id/instances/:name/chatwoot-status', async (req, res) => {
  try {
    const { name: instanceName } = req.params;
    const db = await getDb();
    const business = await db.collection('businesses').findOne({ _id: new ObjectId(req.params.id) });
    if (!business) return res.status(404).json({ error: 'Not found' });

    const instanceInboxes = (business.instanceInboxes as Record<string, number>) ?? {};
    const inboxId = instanceInboxes[instanceName];
    if (!inboxId) return res.json({ configured: false, inboxId: null, botEnabled: false });

    // Check if Agent Bot is assigned
    try {
      const inboxRes = await axios.get(
        `${config.chatwoot.url}/api/v1/accounts/${config.chatwoot.accountId}/inboxes/${inboxId}`,
        { headers: { api_access_token: config.chatwoot.apiKey }, timeout: 8_000 },
      );
      const inbox = inboxRes.data as { id: number; name: string; agent_bot?: { id: number; name: string } };
      res.json({
        configured: true,
        inboxId,
        inboxName: inbox.name,
        botEnabled: !!(inbox.agent_bot?.id),
        agentBot: inbox.agent_bot ?? null,
      });
    } catch {
      res.json({ configured: true, inboxId, botEnabled: false });
    }
  } catch (e) { res.status(500).json({ error: String(e) }); }
});

// Helper log for agent bot operations
function ok(msg: string) { console.log('✅', msg); }

// PUT /api/businesses/:id/instances/:name/assign-agent — vincular/desvincular agente
businessesRouter.put('/:id/instances/:name/assign-agent', async (req, res) => {
  try {
    const db = await getDb();
    const { id, name: instanceName } = req.params;
    const { agentId } = req.body as { agentId: string | null };

    const business = await db.collection('businesses').findOne({ _id: new ObjectId(id) });
    if (!business) return res.status(404).json({ error: 'Not found' });

    const instanceAgents = { ...((business.instanceAgents as Record<string, string>) ?? {}) };
    if (agentId) {
      instanceAgents[instanceName] = agentId;
    } else {
      delete instanceAgents[instanceName];
    }

    const updated = await db.collection('businesses').findOneAndUpdate(
      { _id: new ObjectId(id) },
      { $set: { instanceAgents, updatedAt: new Date() } },
      { returnDocument: 'after' },
    );
    if (!updated) return res.status(404).json({ error: 'Not found' });

    const agents = (business.agents as AgentDoc[]) ?? [];
    const agent = agentId ? (agents.find(a => a._id === agentId) ?? null) : null;
    await syncAgentToRedis(instanceName, agent);

    res.json(updated);
  } catch (e) { res.status(500).json({ error: String(e) }); }
});

// ── Filtro de contatos (blacklist/whitelist) ────────────────────────────────
// Modelo: business.contactFilter = { mode, contacts: string[], groups: string[] }
// Cache rápido para workflow N8N em Redis: contact_filter:{instance} (JSON ou vazio).

interface ContactFilter {
  mode: 'blacklist' | 'whitelist';
  contacts: string[];
  groups: string[];
}

const defaultFilter: ContactFilter = { mode: 'blacklist', contacts: [], groups: [] };

function normalizePhone(p: string): string { return String(p ?? '').replace(/\D/g, ''); }
function normalizeJid(j: string): string {
  const v = String(j ?? '').trim();
  return v.endsWith('@g.us') ? v : v;
}
function sanitizeFilter(f: Partial<ContactFilter> | undefined | null): ContactFilter {
  const mode = f?.mode === 'whitelist' ? 'whitelist' : 'blacklist';
  const contacts = Array.from(new Set((f?.contacts ?? []).map(normalizePhone).filter(Boolean)));
  const groups = Array.from(new Set((f?.groups ?? []).map(normalizeJid).filter(g => g.endsWith('@g.us'))));
  return { mode, contacts, groups };
}

async function syncFilterToRedis(instances: string[], filter: ContactFilter): Promise<void> {
  try {
    const redis = getRedis();
    const payload = JSON.stringify(filter);
    for (const inst of instances) {
      await redis.set(`contact_filter:${inst}`, payload);
    }
  } catch (e) { console.warn('syncFilterToRedis falhou', e); }
}

// GET /api/businesses/:id/contact-filter
businessesRouter.get('/:id/contact-filter', async (req, res) => {
  try {
    const db = await getDb();
    const doc = await db.collection('businesses').findOne(
      { _id: new ObjectId(req.params.id) },
      { projection: { contactFilter: 1 } },
    );
    if (!doc) return res.status(404).json({ error: 'Not found' });
    res.json({ contactFilter: sanitizeFilter(doc.contactFilter as Partial<ContactFilter> | undefined) });
  } catch (e) { res.status(500).json({ error: String(e) }); }
});

// PUT /api/businesses/:id/contact-filter
businessesRouter.put('/:id/contact-filter', async (req, res) => {
  try {
    const filter = sanitizeFilter(req.body as Partial<ContactFilter>);
    const db = await getDb();
    const updated = await db.collection('businesses').findOneAndUpdate(
      { _id: new ObjectId(req.params.id) },
      { $set: { contactFilter: filter, updatedAt: new Date() } },
      { returnDocument: 'after', projection: { instances: 1, contactFilter: 1 } },
    );
    if (!updated) return res.status(404).json({ error: 'Not found' });
    const instances = (updated.instances as string[]) ?? [];
    await syncFilterToRedis(instances, filter);
    res.json({ contactFilter: filter });
  } catch (e) { res.status(500).json({ error: String(e) }); }
});

// GET /api/businesses/:id/instances/:name/groups — proxy Evolution para listar grupos
businessesRouter.get('/:id/instances/:name/groups', async (req, res) => {
  try {
    const r = await axios.get(
      `${config.evolution.url}/group/fetchAllGroups/${encodeURIComponent(req.params.name)}?getParticipants=false`,
      { headers: { apikey: config.evolution.apiKey }, timeout: 15_000, validateStatus: () => true },
    );
    if (r.status >= 400) return res.status(r.status).json({ error: r.data });
    const arr = Array.isArray(r.data) ? r.data : [];
    const groups = arr.map((g: { id?: string; subject?: string; size?: number }) => ({
      id: g.id ?? '',
      subject: g.subject ?? '(sem nome)',
      size: g.size ?? 0,
    })).filter((g: { id: string }) => g.id.endsWith('@g.us'));
    res.json({ groups });
  } catch (e) { res.status(500).json({ error: String(e) }); }
});

// GET /api/businesses/:id/notify-list
businessesRouter.get('/:id/notify-list', async (req, res) => {
  try {
    const db = await getDb();
    const doc = await db.collection('businesses').findOne(
      { _id: new ObjectId(req.params.id) },
      { projection: { escalationNotifyList: 1 } },
    );
    if (!doc) return res.status(404).json({ error: 'Not found' });
    res.json({ escalationNotifyList: (doc.escalationNotifyList as string[]) ?? [] });
  } catch (e) { res.status(500).json({ error: String(e) }); }
});

// POST /api/businesses/:id/notify-list — add or remove a phone
businessesRouter.post('/:id/notify-list', async (req, res) => {
  try {
    const { phone, action } = req.body as { phone?: string; action?: 'add' | 'remove' };
    const digits = String(phone ?? '').replace(/\D/g, '');
    if (!digits) return res.status(400).json({ error: 'phone inválido' });
    if (action !== 'add' && action !== 'remove') return res.status(400).json({ error: 'action deve ser add ou remove' });

    const db = await getDb();
    const op = action === 'add'
      ? { $addToSet: { escalationNotifyList: digits }, $set: { updatedAt: new Date() } }
      : { $pull: { escalationNotifyList: digits } as Record<string, unknown>, $set: { updatedAt: new Date() } };
    const updated = await (db.collection('businesses') as any).findOneAndUpdate(
      { _id: new ObjectId(req.params.id) },
      op,
      { returnDocument: 'after' },
    );
    if (!updated) return res.status(404).json({ error: 'Not found' });
    res.json({ escalationNotifyList: (updated.escalationNotifyList as string[]) ?? [] });
  } catch (e) { res.status(500).json({ error: String(e) }); }
});

// -- Personas e Context Routes (mapeamento JID ? persona) ---------------------
// Modelo:
//   business.personas: [{ key, label, systemPrompt, tools: string[] }]
//   business.contextRoutes: [{ jid, personaKey, restaurantId?: string }]
// Cache r�pido em Redis: persona_routes:{instance} ? JSON {personas, routes}.
// Lido pelo n� "Resolver Persona" do workflow [AGENT] Executor.

export interface Persona {
  key: string;
  label: string;
  systemPrompt: string;
  tools: string[];
}

export interface ContextRoute {
  jid: string;
  personaKey: string;
  restaurantId?: string;
}

function sanitizePersonas(arr: unknown): Persona[] {
  if (!Array.isArray(arr)) return [];
  const seen = new Set<string>();
  const out: Persona[] = [];
  for (const p of arr) {
    const item = p as Partial<Persona>;
    const key = String(item.key ?? '').trim();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push({
      key,
      label: String(item.label ?? key),
      systemPrompt: String(item.systemPrompt ?? ''),
      tools: Array.isArray(item.tools) ? item.tools.map(String) : [],
    });
  }
  return out;
}

function sanitizeRoutes(arr: unknown): ContextRoute[] {
  if (!Array.isArray(arr)) return [];
  const seen = new Set<string>();
  const out: ContextRoute[] = [];
  for (const r of arr) {
    const item = r as Partial<ContextRoute>;
    const jid = String(item.jid ?? '').trim();
    const personaKey = String(item.personaKey ?? '').trim();
    if (!jid || !personaKey || seen.has(jid)) continue;
    seen.add(jid);
    const route: ContextRoute = { jid, personaKey };
    if (item.restaurantId) route.restaurantId = String(item.restaurantId);
    out.push(route);
  }
  return out;
}

/** Reconstr�i e grava `persona_routes:{instance}` para todas as inst�ncias do neg�cio. */
export async function syncPersonaRoutesToRedis(businessId: string): Promise<void> {
  try {
    const db = await getDb();
    const biz = await db.collection('businesses').findOne(
      { _id: new ObjectId(businessId) },
      { projection: { instances: 1, personas: 1, contextRoutes: 1 } },
    );
    if (!biz) return;
    const instances = (biz.instances as string[]) ?? [];
    const personas = sanitizePersonas(biz.personas);
    const routes = sanitizeRoutes(biz.contextRoutes);
    const payload = JSON.stringify({
      personas: Object.fromEntries(personas.map(p => [p.key, p])),
      routes,
    });
    const redis = getRedis();
    for (const inst of instances) {
      if (personas.length === 0 && routes.length === 0) {
        await redis.del(`persona_routes:${inst}`);
      } else {
        await redis.set(`persona_routes:${inst}`, payload);
      }
    }
  } catch (e) { console.warn('syncPersonaRoutesToRedis falhou', e); }
}

// GET /api/businesses/:id/personas
businessesRouter.get('/:id/personas', async (req, res) => {
  try {
    const db = await getDb();
    const doc = await db.collection('businesses').findOne(
      { _id: new ObjectId(req.params.id) },
      { projection: { personas: 1, contextRoutes: 1 } },
    );
    if (!doc) return res.status(404).json({ error: 'Not found' });
    res.json({
      personas: sanitizePersonas(doc.personas),
      contextRoutes: sanitizeRoutes(doc.contextRoutes),
    });
  } catch (e) { res.status(500).json({ error: String(e) }); }
});

// PUT /api/businesses/:id/personas � body: { personas: [...] }
businessesRouter.put('/:id/personas', async (req, res) => {
  try {
    const personas = sanitizePersonas((req.body as { personas?: unknown }).personas);
    const db = await getDb();
    const updated = await db.collection('businesses').findOneAndUpdate(
      { _id: new ObjectId(req.params.id) },
      { $set: { personas, updatedAt: new Date() } },
      { returnDocument: 'after', projection: { personas: 1, contextRoutes: 1, instances: 1 } },
    );
    if (!updated) return res.status(404).json({ error: 'Not found' });
    await syncPersonaRoutesToRedis(req.params.id);
    res.json({ personas });
  } catch (e) { res.status(500).json({ error: String(e) }); }
});

// PUT /api/businesses/:id/context-routes � body: { contextRoutes: [...] }
businessesRouter.put('/:id/context-routes', async (req, res) => {
  try {
    const contextRoutes = sanitizeRoutes((req.body as { contextRoutes?: unknown }).contextRoutes);
    const db = await getDb();
    const updated = await db.collection('businesses').findOneAndUpdate(
      { _id: new ObjectId(req.params.id) },
      { $set: { contextRoutes, updatedAt: new Date() } },
      { returnDocument: 'after', projection: { contextRoutes: 1, instances: 1 } },
    );
    if (!updated) return res.status(404).json({ error: 'Not found' });
    await syncPersonaRoutesToRedis(req.params.id);
    res.json({ contextRoutes });
  } catch (e) { res.status(500).json({ error: String(e) }); }
});

// GET /api/businesses/:id/instances/:name/contacts � proxy Evolution para listar contatos
businessesRouter.get('/:id/instances/:name/contacts', async (req, res) => {
  try {
    const r = await axios.post(
      `${config.evolution.url}/chat/findContacts/${encodeURIComponent(req.params.name)}`,
      {},
      { headers: { apikey: config.evolution.apiKey }, timeout: 15_000, validateStatus: () => true },
    );
    if (r.status >= 400) return res.status(r.status).json({ error: r.data });
    const arr = Array.isArray(r.data) ? r.data : [];
    const contacts = arr
      .filter((c: { id?: string }) => typeof c.id === 'string' && !c.id.endsWith('@g.us'))
      .map((c: { id?: string; pushName?: string; profilePicUrl?: string }) => ({
        id: c.id ?? '',
        name: c.pushName ?? c.id ?? '',
      }));
    res.json({ contacts });
  } catch (e) { res.status(500).json({ error: String(e) }); }
});
