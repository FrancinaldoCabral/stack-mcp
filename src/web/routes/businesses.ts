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
      if (inbox) instanceChatwootInboxId = inbox.id;

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

// GET /api/businesses/:id/qr — admin: fetch QR code from Evolution
businessesRouter.get('/:id/qr', async (req, res) => {
  try {
    const db = await getDb();
    const business = await db.collection('businesses').findOne({ _id: new ObjectId(req.params.id) });
    if (!business?.instances?.length) return res.status(404).json({ error: 'Nenhuma instância configurada' });
    const instanceName = (business.instances as string[])[0];
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
    const instanceName = (business.instances as string[])[0];
    const r = await axios.get(`${config.evolution.url}/instance/connectionState/${instanceName}`, {
      headers: { apikey: config.evolution.apiKey },
    });
    const state: string = r.data?.instance?.state ?? r.data?.state ?? 'unknown';
    res.json({ status: state, instanceName });
  } catch {
    res.json({ status: 'unknown' });
  }
});

// POST /api/businesses/:id/qr-link — admin: generate link + send email
businessesRouter.post('/:id/qr-link', async (req, res) => {
  try {
    const { email } = req.body as { email?: string };
    if (!email?.trim()) return res.status(400).json({ error: 'email é obrigatório' });

    const db = await getDb();
    const business = await db.collection('businesses').findOne({ _id: new ObjectId(req.params.id) });
    if (!business?.instances?.length) return res.status(400).json({ error: 'Negócio não está provisionado' });

    const instanceName = (business.instances as string[])[0];
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

    await sendQrLinkEmail(email.trim(), connectUrl, business.name as string);
    res.json({ ok: true, connectUrl });
  } catch (e) {
    const err = e as { response?: { data?: unknown }; message?: string };
    const detail = err.response?.data ?? err.message ?? String(e);
    res.status(500).json({ error: typeof detail === 'string' ? detail : JSON.stringify(detail) });
  }
});
