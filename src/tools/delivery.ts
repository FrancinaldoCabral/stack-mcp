import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import { ObjectId, type WithId, type Document } from 'mongodb';
import { config } from '../config.js';
import { createClient, safeRequest, toText } from '../utils/http.js';
import { getDb } from './mongodb.js';

// Helper: serializa qualquer payload (já desembrulhado) como JSON. toText() é só
// para o resultado de safeRequest (que vem em {data}|{error}).
const json = (v: unknown): string => JSON.stringify(v, null, 2);

// ── Cliente Evolution (compartilhado com tools/evolution) ────────────────────
const evolution = () =>
  createClient(config.evolution.url, {
    apikey: config.evolution.apiKey,
    'Content-Type': 'application/json',
  });

// ── Helpers ──────────────────────────────────────────────────────────────────

async function getRestaurant(id: string): Promise<WithId<Document> | null> {
  const db = await getDb();
  return db.collection('delivery_restaurants').findOne({ _id: new ObjectId(id) });
}

async function getRestaurantInstance(restaurant: WithId<Document>): Promise<string> {
  // O nó do workflow guarda `instance` no contexto; aqui precisamos resolver pelo business.
  const bizId = restaurant.businessId as string | undefined;
  if (!bizId) {
    throw new Error('Restaurante sem businessId — não é possível resolver a instância de envio');
  }
  const db = await getDb();
  const biz = await db.collection('businesses').findOne(
    { _id: new ObjectId(bizId) },
    { projection: { instances: 1 } },
  );
  const inst = (biz?.instances as string[] | undefined)?.[0];
  if (!inst) throw new Error(`Business ${bizId} não tem instâncias configuradas`);
  return inst;
}

async function sendToJid(
  instance: string,
  jid: string,
  text: string,
  mentionedList?: string[],
  quotedMessageId?: string,
): Promise<unknown> {
  const http = evolution();
  const body: Record<string, unknown> = { number: jid, text, delay: 500 };
  if (mentionedList?.length) body.mentionedList = mentionedList;
  if (quotedMessageId) body.quoted = { key: { id: quotedMessageId } };
  return safeRequest(() =>
    http.post(`/message/sendText/${instance}`, body).then(r => r.data)
  );
}

/** Extrai o message ID da resposta da Evolution API (key.id).
 *  safeRequest envolve com { data: EvolutionResponse } ou { error: string }.
 */
function extractMessageId(res: unknown): string | null {
  const r = res as Record<string, unknown> | null;
  // Tenta { data: { key: { id } } } (caminho normal via safeRequest)
  const inner = (r?.data ?? r) as Record<string, unknown> | undefined;
  const key = inner?.key as Record<string, unknown> | undefined;
  return typeof key?.id === 'string' ? key.id : null;
}

function genOrderRef(): string {
  // Ref curto e legível: LT-<6 chars base36 do timestamp>-<3 random>
  const ts = Date.now().toString(36).slice(-6).toUpperCase();
  const rnd = Math.random().toString(36).slice(2, 5).toUpperCase();
  return `LT-${ts}-${rnd}`;
}

function formatOrderSummary(order: WithId<Document>): string {
  const lines: string[] = [];
  lines.push(`*Pedido ${order.orderRef ?? order._id}*`);
  // externalCode: sempre presente — campo "Code" da plataforma de origem (iFood, Uber Eats, etc.)
  // Mostrado mesmo se vazio para que entregadores saibam que o campo existe
  lines.push(`🔑 Code: ${order.externalCode ? String(order.externalCode) : '—'}`);
  if (order.clientName) lines.push(`Cliente: ${order.clientName}`);
  if (order.clientAddress) lines.push(`Endereço: ${order.clientAddress}`);
  if (order.clientPhone) lines.push(`Telefone: ${order.clientPhone}`);
  if (Array.isArray(order.items) && order.items.length) {
    lines.push(`Itens:\n${order.items.map((it: unknown) => `  • ${String(it)}`).join('\n')}`);
  }
  if (order.value != null) lines.push(`Valor pedido: €${Number(order.value).toFixed(2)}`);
  if (order.deliveryFee != null) {
    const distStr = order.distanceKm != null ? ` (${Number(order.distanceKm).toFixed(1)} km)` : '';
    lines.push(`Taxa de entrega: €${Number(order.deliveryFee).toFixed(2)}${distStr}`);
  }
  if (order.paymentMethod) lines.push(`Pagamento: ${order.paymentMethod}`);
  if (order.notes) lines.push(`Obs: ${order.notes}`);
  if (order.status) lines.push(`Status: ${order.status}`);
  if (order.delivererName) lines.push(`Entregador: ${order.delivererName}`);
  return lines.join('\n');
}

// ── Definições MCP ───────────────────────────────────────────────────────────

export const deliveryTools: Tool[] = [
  {
    name: 'delivery_list_restaurants',
    description: 'Lista restaurantes cadastrados na LivraisonTotale (ativos por padrão).',
    inputSchema: {
      type: 'object',
      properties: {
        businessId: { type: 'string', description: 'Filtrar por negócio (opcional)' },
        includeInactive: { type: 'boolean' },
      },
    },
  },
  {
    name: 'delivery_get_restaurant',
    description: 'Retorna um restaurante por ID (inclui JIDs de comando e de entregadores).',
    inputSchema: {
      type: 'object',
      required: ['restaurantId'],
      properties: { restaurantId: { type: 'string' } },
    },
  },
  {
    name: 'delivery_draft_order',
    description: 'Cria ou atualiza o rascunho de pedido para o restaurante (upsert — se já existe um rascunho aberto, ele é atualizado em vez de duplicar). NÃO posta no grupo ainda — usa delivery_confirm_order para liberar.',
    inputSchema: {
      type: 'object',
      required: ['restaurantId'],
      properties: {
        restaurantId: { type: 'string' },
        clientName: { type: 'string' },
        clientAddress: { type: 'string' },
        clientPhone: { type: 'string' },
        items: { type: 'array', items: { type: 'string' }, description: 'Lista de itens do pedido em texto livre' },
        value: { type: 'number', description: 'Valor do pedido em €' },
        deliveryFee: { type: 'number', description: 'Taxa de entrega em € (use delivery_calc_fee para calcular ou preencha se já souber)' },
        paymentMethod: { type: 'string', description: 'Forma de pagamento (ex: dinheiro, cartão na entrega, MB Way, Multibanco)' },
        externalCode: { type: 'string', description: 'Código/comanda de outra plataforma (iFood, Uber Eats, etc.). Solicite ao restaurante — pode ficar em branco se não houver, mas SEMPRE pergunte antes de confirmar.' },
        commune: { type: 'string', description: 'Município/bairro do cliente (ex: Ixelles, Uccle, Bruxelles)' },
        notes: { type: 'string', description: 'Observações livres' },
      },
    },
  },
  {
    name: 'delivery_update_draft',
    description: 'Atualiza campos de um pedido em rascunho. Não funciona em pedidos já confirmados (use delivery_update_order_status).',
    inputSchema: {
      type: 'object',
      required: ['orderId'],
      properties: {
        orderId: { type: 'string' },
        clientName: { type: 'string' },
        clientAddress: { type: 'string' },
        clientPhone: { type: 'string' },
        items: { type: 'array', items: { type: 'string' } },
        value: { type: 'number', description: 'Valor do pedido em €' },
        deliveryFee: { type: 'number', description: 'Taxa de entrega em €' },
        paymentMethod: { type: 'string' },
        externalCode: { type: 'string', description: 'Código/comanda de outra plataforma (iFood, Uber Eats, etc.) — inclua mesmo se vazio string' },
        commune: { type: 'string', description: 'Município/bairro do cliente' },
        notes: { type: 'string' },
      },
    },
  },
  {
    name: 'delivery_confirm_order',
    description: 'Confirma o rascunho e posta no grupo de entregadores. Se o orderId estiver no Contexto Operacional (ÚLTIMO RASCUNHO), use-o. Caso contrário auto-encontra o rascunho mais recente do restaurante. NÃO chame delivery_draft_order antes — use o rascunho existente.',
    inputSchema: {
      type: 'object',
      properties: {
        orderId: { type: 'string', description: 'ID do rascunho. Omita para usar o rascunho mais recente do restaurante.' },
        restaurantId: { type: 'string', description: 'Necessário apenas se orderId não for informado (para localizar o rascunho).' },
        crossPost: { type: 'boolean', description: 'Também postar no grupo de entregadores (default false)' },
      },
    },
  },
  {
    name: 'delivery_create_order',
    description: 'Cria um pedido diretamente em status "pendente" (atalho — pula rascunho). Use apenas quando todos os dados já estão validados.',
    inputSchema: {
      type: 'object',
      required: ['restaurantId'],
      properties: {
        restaurantId: { type: 'string' },
        clientName: { type: 'string' },
        clientAddress: { type: 'string' },
        clientPhone: { type: 'string' },
        items: { type: 'array', items: { type: 'string' } },
        value: { type: 'number' },
        paymentMethod: { type: 'string' },
        externalCode: { type: 'string', description: 'Código externo da plataforma (iFood, Uber Eats, etc.) — somente se informado' },
        notes: { type: 'string' },
        delivererJid: { type: 'string' },
        delivererName: { type: 'string' },
      },
    },
  },
  {
    name: 'delivery_update_order_status',
    description: 'Atualiza status de um pedido existente. Por padrão também posta atualização no grupo de comandos do restaurante (espelhamento entregador → restaurante).',
    inputSchema: {
      type: 'object',
      required: ['orderId', 'status'],
      properties: {
        orderId: { type: 'string' },
        status: { type: 'string', enum: ['rascunho', 'pendente', 'aceito', 'a_caminho', 'entregue', 'cancelado'] },
        note: { type: 'string', description: 'Observação a anexar e enviar ao grupo de comandos' },
        notifyCommandGroup: { type: 'boolean', description: 'Postar no grupo de comandos (default true)' },
      },
    },
  },
  {
    name: 'delivery_assign_deliverer',
    description: 'Atribui um entregador a um pedido (somente se ainda sem entregador — controle de concorrência). Notifica automaticamente o grupo de comandos. Se o pedido já foi aceito por outro entregador, retorna {ok:false, alreadyTaken:true}.',
    inputSchema: {
      type: 'object',
      required: ['orderId', 'delivererJid', 'delivererName'],
      properties: {
        orderId: { type: 'string' },
        delivererJid: { type: 'string' },
        delivererName: { type: 'string' },
        etaMin: { type: 'number' },
      },
    },
  },
  {
    name: 'delivery_cancel_by_deliverer',
    description: 'Entregador cancela/desiste de um pedido. O pedido volta a status pendente e é re-postado no grupo para outro entregador assumir. Use quando o entregador explicitamente desiste.',
    inputSchema: {
      type: 'object',
      required: ['orderId', 'delivererJid'],
      properties: {
        orderId: { type: 'string' },
        delivererJid: { type: 'string', description: 'JID do entregador que está cancelando (deve ser o entregador atual)' },
        reason: { type: 'string', description: 'Motivo do cancelamento (opcional)' },
      },
    },
  },
  {
    name: 'delivery_list_orders',
    description: 'Lista pedidos. Filtros opcionais por restaurantId, status, delivererJid, últimos N dias.',
    inputSchema: {
      type: 'object',
      properties: {
        restaurantId: { type: 'string' },
        status: { type: 'string' },
        delivererJid: { type: 'string' },
        days: { type: 'number' },
        limit: { type: 'number' },
      },
    },
  },
  {
    name: 'delivery_get_order',
    description: 'Retorna um pedido por ID ou orderRef (LT-XXXXXX). O campo lastDelivererGroupMsgId contém o ID da última mensagem postada no grupo de entregadores — use como quotedMessageId para responder diretamente ao post do pedido.',
    inputSchema: {
      type: 'object',
      required: ['orderIdOrRef'],
      properties: { orderIdOrRef: { type: 'string' } },
    },
  },
  {
    name: 'delivery_log_settlement',
    description: 'Registra um lançamento financeiro (débito/crédito) na conta corrente de um entregador.',
    inputSchema: {
      type: 'object',
      required: ['delivererJid', 'delivererName', 'type', 'amount'],
      properties: {
        delivererJid: { type: 'string' },
        delivererName: { type: 'string' },
        type: { type: 'string', enum: ['debito', 'credito'], description: 'debito = entregador deve à LT; credito = LT deve ao entregador' },
        amount: { type: 'number' },
        description: { type: 'string' },
        restaurantId: { type: 'string' },
        restaurantName: { type: 'string' },
        orderId: { type: 'string' },
        orderRef: { type: 'string' },
      },
    },
  },
  {
    name: 'delivery_post_to_command_group',
    description: 'Envia mensagem ao grupo (ou contato) de comandos do restaurante. Use para espelhar comunicações importantes do entregador para o restaurante.',
    inputSchema: {
      type: 'object',
      required: ['restaurantId', 'message'],
      properties: {
        restaurantId: { type: 'string' },
        message: { type: 'string', description: 'Texto da mensagem a enviar ao grupo' },
        text: { type: 'string', description: 'Alias de message (deprecated)' },
        mentionedList: {
          type: 'array',
          items: { type: 'string' },
          description: 'JIDs a mencionar com @ (ex: ["5511999@s.whatsapp.net"]). O texto deve conter @NUMERO correspondente.',
        },
        quotedMessageId: { type: 'string', description: 'ID de uma mensagem anterior para responder (WhatsApp reply/quote).' },
      },
    },
  },
  {
    name: 'delivery_post_to_deliverer_group',
    description: 'Envia mensagem ao grupo de entregadores. Para @mencionar um entregador inclua o JID em mentionedList e @NUMERO no texto. Para responder a uma mensagem específica use quotedMessageId.',
    inputSchema: {
      type: 'object',
      required: ['restaurantId', 'message'],
      properties: {
        restaurantId: { type: 'string' },
        message: { type: 'string', description: 'Texto da mensagem. Inclua @NUMERO (sem código do país) para cada JID em mentionedList.' },
        text: { type: 'string', description: 'Alias de message (deprecated)' },
        mentionedList: {
          type: 'array',
          items: { type: 'string' },
          description: 'JIDs a mencionar com @ (ex: ["5511999@s.whatsapp.net"]). O texto DEVE conter @5511999 (sem @s.whatsapp.net) para cada JID.',
        },
        quotedMessageId: { type: 'string', description: 'ID de uma mensagem anterior para responder (WhatsApp reply/quote). Use o lastMsgId do pedido quando disponível.' },
      },
    },
  },
  {
    name: 'delivery_calc_fee',
    description: 'Calcula distância de condução e taxa de entrega (€) via Google Routes API. Aceita endereços completos como texto — sem geocoding separado. Se orderId fornecido, salva a taxa automaticamente no pedido.',
    inputSchema: {
      type: 'object',
      required: ['restaurantId', 'clientAddress'],
      properties: {
        restaurantId: { type: 'string', description: 'ID do restaurante de origem' },
        clientAddress: { type: 'string', description: 'Endereço completo de entrega (rua, número, cidade, país)' },
        originAddress: { type: 'string', description: 'Sobrepõe o endereço cadastrado do restaurante (opcional)' },
        orderId: { type: 'string', description: 'Se informado, salva a taxa calculada no pedido automaticamente' },
      },
    },
  },
];

// ── Google Routes API v2 ─────────────────────────────────────────────────────

/**
 * Calcula a distância de condução entre dois endereços usando a Google Routes API v2.
 * Aceita strings de endereço diretamente — sem geocoding separado.
 */
async function computeRouteDistanceKm(originAddress: string, destAddress: string): Promise<number> {
  const apiKey = config.google.routeApiKey;
  if (!apiKey) throw new Error('GOOGLE_ROUTE_API_KEY não configurada');

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 10_000);
  let r: Response;
  try {
    r = await fetch('https://routes.googleapis.com/directions/v2:computeRoutes', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Goog-Api-Key': apiKey,
        'X-Goog-FieldMask': 'routes.distanceMeters',
      },
      body: JSON.stringify({
        origin: { address: originAddress },
        destination: { address: destAddress },
        travelMode: 'DRIVE',
        routingPreference: 'TRAFFIC_UNAWARE',
      }),
      signal: ctrl.signal,
    });
  } finally {
    clearTimeout(timer);
  }

  if (!r.ok) {
    const body = await r.text().catch(() => '');
    throw new Error(`Google Routes API ${r.status}: ${body.slice(0, 200)}`);
  }

  const data = await r.json() as { routes?: Array<{ distanceMeters: number }> };
  const meters = data?.routes?.[0]?.distanceMeters;
  if (typeof meters !== 'number') throw new Error('Google Routes API não retornou rota para esses endereços');
  return meters / 1000;
}

// ── Auto fee calculation ─────────────────────────────────────────────────────

/**
 * Tenta calcular a taxa de entrega para o pedido.
 * Retorna { feeEur, distanceKm } se bem-sucedido, null se não for possível
 * (endereço ausente, tabela não configurada, geocoding falhou, etc.).
 * Nunca lança — falhas são silenciosas (best-effort).
 */
async function tryCalcFee(
  restaurant: import('mongodb').WithId<import('mongodb').Document>,
  clientAddress: string,
): Promise<{ feeEur: number; distanceKm: number } | null> {
  try {
    const originAddress = (restaurant.address as string | undefined)?.trim();
    if (!originAddress || !clientAddress.trim()) return null;

    const distanceKm = await computeRouteDistanceKm(originAddress, clientAddress.trim());

    const db = await getDb();
    const bizId = restaurant.businessId as string | undefined;
    if (!bizId) return null;
    const biz = await db.collection('businesses').findOne(
      { _id: new ObjectId(bizId) },
      { projection: { 'settings.deliveryFeeTable': 1 } },
    );
    const table = (biz?.settings?.deliveryFeeTable as Array<{ minKm: number; maxKm: number; feeEur: number }> | undefined) ?? [];
    if (!table.length) return null;

    const band = table.find(b => distanceKm >= b.minKm && distanceKm <= b.maxKm);
    if (!band) return null;

    return { feeEur: band.feeEur, distanceKm: Math.round(distanceKm * 10) / 10 };
  } catch {
    return null;
  }
}

// ── Handler ──────────────────────────────────────────────────────────────────

export async function handleDeliveryTool(
  name: string,
  args: Record<string, unknown>
): Promise<string> {
  const db = await getDb();

  switch (name) {
    case 'delivery_list_restaurants': {
      const filter: Record<string, unknown> = {};
      if (args.businessId) filter.businessId = String(args.businessId);
      if (!args.includeInactive) filter.active = { $ne: false };
      const docs = await db.collection('delivery_restaurants').find(filter).sort({ name: 1 }).toArray();
      return json(docs);
    }

    case 'delivery_get_restaurant': {
      const doc = await getRestaurant(String(args.restaurantId));
      if (!doc) return json({ error: 'Restaurante não encontrado' });
      return json(doc);
    }

    case 'delivery_draft_order':
    case 'delivery_create_order': {
      const r = await getRestaurant(String(args.restaurantId));
      if (!r) return json({ error: 'Restaurante não encontrado' });
      const now = new Date();
      const status = name === 'delivery_draft_order' ? 'rascunho' : 'pendente';

      // ── Upsert de rascunho ──────────────────────────────────────────────────
      // Se já existe um rascunho aberto para este restaurante, ATUALIZA em vez de criar
      // um novo documento. Isso evita duplicações quando o LLM chama delivery_draft_order
      // múltiplas vezes durante a captura do mesmo pedido (ex: adiciona paymentMethod).
      // Nota: upsert só se aplica a rascunho. Pedidos já confirmados (pendente, aceito, etc.)
      // não são afetados, permitindo múltiplos pedidos simultâneos normalmente.
      if (name === 'delivery_draft_order') {
        const existing = await db.collection('delivery_orders').findOne(
          { restaurantId: String(r._id), status: 'rascunho' },
          { sort: { createdAt: -1 } },
        );
        if (existing) {
          const UPD_FIELDS = ['clientName', 'clientAddress', 'clientPhone', 'items', 'value', 'deliveryFee', 'paymentMethod', 'externalCode', 'notes'];
          const upd: Record<string, unknown> = { updatedAt: now };
          for (const k of UPD_FIELDS) if (args[k] !== undefined) upd[k] = args[k];
          if (args.commune !== undefined) upd.clientCommune = args.commune;
          // Calcula taxa se endereço foi atualizado ou ainda não calculado
          const addrForFee = (args.clientAddress ? String(args.clientAddress) : null)
            ?? (existing.clientAddress as string | null);
          if (args.deliveryFee == null && addrForFee && existing.deliveryFee == null) {
            const af = await tryCalcFee(r, addrForFee);
            if (af) { upd.deliveryFee = af.feeEur; upd.distanceKm = af.distanceKm; }
          }
          const updated = await db.collection('delivery_orders').findOneAndUpdate(
            { _id: existing._id }, { $set: upd }, { returnDocument: 'after' },
          );
          const feeOk = updated!.deliveryFee != null;
          return json({
            ok: true,
            orderId: updated!._id,
            orderRef: updated!.orderRef,
            status: 'rascunho',
            updated: true,
            deliveryFee: updated!.deliveryFee,
            distanceKm: updated!.distanceKm,
            feeStatus: feeOk ? 'calculated' : 'pending',
            feeHint: feeOk ? undefined : 'Taxa ainda não calculada. Chame delivery_calc_fee(restaurantId, clientAddress, orderId) assim que tiver o endereço completo.',
          });
        }
      }
      // ── Sem rascunho existente — cria novo documento ────────────────────────

      // Calcula taxa automaticamente se não foi fornecida explicitamente
      let autoFee: { feeEur: number; distanceKm: number } | null = null;
      if (args.deliveryFee == null && args.clientAddress) {
        autoFee = await tryCalcFee(r, String(args.clientAddress));
      }

      const doc: Record<string, unknown> = {
        orderRef: genOrderRef(),
        restaurantId: String(r._id),
        restaurantName: r.name,
        businessId: r.businessId ?? null,
        clientName: args.clientName ?? '',
        clientAddress: args.clientAddress ?? '',
        clientCommune: args.commune ?? '',
        clientPhone: args.clientPhone ?? '',
        items: Array.isArray(args.items) ? args.items : [],
        value: args.value != null ? Number(args.value) : null,
        deliveryFee: args.deliveryFee != null ? Number(args.deliveryFee) : (autoFee?.feeEur ?? null),
        distanceKm: autoFee?.distanceKm ?? null,
        paymentMethod: args.paymentMethod ?? null,
        externalCode: args.externalCode ?? null,
        notes: args.notes ?? '',
        delivererJid: args.delivererJid ?? null,
        delivererName: args.delivererName ?? null,
        status,
        createdAt: now,
        updatedAt: now,
      };
      const result = await db.collection('delivery_orders').insertOne(doc);
      const feeOk = doc.deliveryFee != null;
      return json({
        ok: true,
        orderId: result.insertedId,
        orderRef: doc.orderRef,
        status,
        deliveryFee: doc.deliveryFee,
        distanceKm: doc.distanceKm,
        feeStatus: feeOk ? 'calculated' : 'pending',
        feeHint: feeOk ? undefined : 'Taxa não calculada automaticamente (verifique se o restaurante tem endereço e se o negócio tem deliveryFeeTable). Chame delivery_calc_fee(restaurantId, clientAddress, orderId) para calcular.',
      });
    }

    case 'delivery_update_draft': {
      const id = new ObjectId(String(args.orderId));
      const current = await db.collection('delivery_orders').findOne({ _id: id });
      if (!current) return json({ error: 'Pedido não encontrado' });
      if (current.status !== 'rascunho') {
        return json({ error: `Pedido não está em rascunho (status atual: ${current.status}). Use delivery_update_order_status.` });
      }
      const PATCHABLE = ['clientName', 'clientAddress', 'clientPhone', 'items', 'value', 'deliveryFee', 'paymentMethod', 'externalCode', 'notes'];
      const update: Record<string, unknown> = { updatedAt: new Date() };
      for (const k of PATCHABLE) if (args[k] !== undefined) update[k] = args[k];
      if (args.commune !== undefined) update.clientCommune = args.commune;
      // Se endereço foi atualizado e taxa não foi fornecida, recalcula
      if (args.clientAddress && args.deliveryFee == null) {
        const restaurant = await getRestaurant(String(current.restaurantId));
        if (restaurant) {
          const autoFee = await tryCalcFee(restaurant, String(args.clientAddress));
          if (autoFee) {
            update.deliveryFee = autoFee.feeEur;
            update.distanceKm = autoFee.distanceKm;
          }
        }
      }
      const result = await db.collection('delivery_orders').findOneAndUpdate(
        { _id: id }, { $set: update }, { returnDocument: 'after' },
      );
      return json(result);
    }

    case 'delivery_confirm_order': {
      // Se orderId não fornecido, auto-encontra o rascunho mais recente do restaurante
      let orderFilter: Record<string, unknown> = { status: 'rascunho' };
      if (args.orderId) {
        orderFilter = { _id: new ObjectId(String(args.orderId)), status: 'rascunho' };
      } else if (args.restaurantId) {
        orderFilter = { restaurantId: String(args.restaurantId), status: 'rascunho' };
      } else {
        return json({ error: 'Informe orderId ou restaurantId para confirmar o pedido' });
      }
      const order = await db.collection('delivery_orders').findOneAndUpdate(
        orderFilter,
        { $set: { status: 'pendente', updatedAt: new Date() } },
        { returnDocument: 'after', sort: { createdAt: -1 } },
      );
      if (!order) return json({ error: 'Pedido não encontrado ou não está em rascunho' });

      const r = await getRestaurant(String(order.restaurantId));
      if (!r) return json({ ok: true, warning: 'Pedido confirmado, mas restaurante não encontrado para postagem' });

      // Calcula taxa se ainda não foi calculada
      if (order.deliveryFee == null && order.clientAddress) {
        const autoFee = await tryCalcFee(r, String(order.clientAddress));
        if (autoFee) {
          await db.collection('delivery_orders').updateOne(
            { _id: order._id },
            { $set: { deliveryFee: autoFee.feeEur, distanceKm: autoFee.distanceKm, updatedAt: new Date() } },
          );
          order.deliveryFee = autoFee.feeEur;
          order.distanceKm = autoFee.distanceKm;
        }
      }

      const instance = await getRestaurantInstance(r);
      // ↩️ instrução de reply é ESSENCIAL — o filtro mecânico do agente só ativa via WhatsApp reply
      const text = `🆕 Novo pedido:\n\n${formatOrderSummary(order)}\n\n↩️ *Responda esta mensagem* para aceitar.`;
      const cmdJid = String((r.commandJid ?? r.commandGroupJid) ?? '').trim();
      const sent: Record<string, unknown> = {};
      if (cmdJid) sent.commandGroup = await sendToJid(instance, cmdJid, text.replace('\n\n_Quem aceita? *Responda esta mensagem* para pegar o pedido._', ''));
      let delivererMsgId: string | null = null;
      if (r.delivererGroupJid) {
        const dlvSent = await sendToJid(instance, String(r.delivererGroupJid), text);
        sent.delivererGroup = dlvSent;
        delivererMsgId = extractMessageId(dlvSent);
        if (delivererMsgId) {
          await db.collection('delivery_orders').updateOne(
            { _id: order._id },
            { $set: { lastDelivererGroupMsgId: delivererMsgId, updatedAt: new Date() } },
          );
        }
      }
      return json({ ok: true, orderRef: order.orderRef, deliveryFee: order.deliveryFee, delivererMsgId, sent });
    }

    case 'delivery_update_order_status': {
      const id = new ObjectId(String(args.orderId));
      const status = String(args.status);
      const note = args.note ? String(args.note) : '';
      const order = await db.collection('delivery_orders').findOneAndUpdate(
        { _id: id },
        { $set: { status, ...(note ? { lastNote: note } : {}), updatedAt: new Date() } },
        { returnDocument: 'after' },
      );
      if (!order) return json({ error: 'Pedido não encontrado' });

      const r = await getRestaurant(String(order.restaurantId));
      if (!r) return json({ ok: true, order, warning: 'Restaurante não encontrado' });
      const instance = await getRestaurantInstance(r);

      // Quando o restaurante cancela um pedido com entregador atribuído:
      // notifica o entregador no grupo de entregadores com @menção
      if (status === 'cancelado' && order.delivererJid) {
        try {
          const dlvGrp = String(r.delivererGroupJid ?? '').trim();
          if (dlvGrp) {
            const dlvJid = String(order.delivererJid);
            const dlvName = String(order.delivererName ?? 'entregador');
            const phone = dlvJid.replace('@s.whatsapp.net', '');
            const cancelText = `❌ Pedido *${order.orderRef}* foi CANCELADO pelo restaurante.\n@${phone}, o pedido foi cancelado${note ? `: ${note}` : '.'}`;
            await sendToJid(instance, dlvGrp, cancelText, [dlvJid]);
          }
        } catch { /* best-effort */ }
      }

      const notify = args.notifyCommandGroup !== false;
      if (!notify) return json({ ok: true, order });
      const cmdJid = String((r.commandJid ?? r.commandGroupJid) ?? '').trim();
      if (!cmdJid) return json({ ok: true, order, warning: 'Restaurante sem commandJid' });
      const feeStr = order.deliveryFee != null ? ` | Taxa: €${Number(order.deliveryFee).toFixed(2)}` : '';
      const text = `📦 Pedido *${order.orderRef ?? order._id}* — status: *${status}*${feeStr}${note ? `\n${note}` : ''}`;
      const sent = await sendToJid(instance, cmdJid, text);
      return json({ ok: true, order, sent });
    }

    case 'delivery_assign_deliverer': {
      const id = new ObjectId(String(args.orderId));
      const newDelivererJid = String(args.delivererJid);

      const upd: Record<string, unknown> = {
        delivererJid: newDelivererJid,
        delivererName: String(args.delivererName),
        status: 'aceito',
        updatedAt: new Date(),
      };
      if (args.etaMin != null) upd.etaMin = Number(args.etaMin);

      // Atribuição atômica: só sucede se o pedido ainda não tem entregador
      // (ou o mesmo entregador está re-confirmando sua atribuição)
      const result = await db.collection('delivery_orders').findOneAndUpdate(
        {
          _id: id,
          $or: [
            { delivererJid: { $in: [null, undefined, '', newDelivererJid] } },
            { delivererJid: { $exists: false } },
            { status: 'pendente' },
          ],
        },
        { $set: upd },
        { returnDocument: 'after' },
      );

      if (!result) {
        // Pedido já foi aceito por outro entregador
        const current = await db.collection('delivery_orders').findOne({ _id: id });
        return json({
          ok: false,
          alreadyTaken: true,
          orderRef: current?.orderRef ?? '',
          currentDelivererName: current?.delivererName ?? '',
          message: `Pedido ${current?.orderRef} já foi aceito por ${current?.delivererName}. Aguarde o próximo!`,
        });
      }

      // Notifica grupo de comandos do restaurante
      try {
        const r = await getRestaurant(String(result.restaurantId));
        if (r) {
          const cmdJid = String((r.commandJid ?? r.commandGroupJid) ?? '').trim();
          if (cmdJid) {
            const instance = await getRestaurantInstance(r);
            const eta = args.etaMin != null ? ` (~${args.etaMin} min)` : '';
            const notifText = `🛵 Entregador *${args.delivererName}* assumiu o pedido *${result.orderRef ?? result._id}*${eta}`;
            await sendToJid(instance, cmdJid, notifText);
          }
        }
      } catch { /* best-effort */ }
      return json({ ok: true, order: result, notified: true, lastDelivererGroupMsgId: result.lastDelivererGroupMsgId ?? null });
    }

    case 'delivery_cancel_by_deliverer': {
      const id = new ObjectId(String(args.orderId));
      const delivererJid = String(args.delivererJid);

      const current = await db.collection('delivery_orders').findOne({ _id: id });
      if (!current) return json({ error: 'Pedido não encontrado' });

      // Verifica se o entregador que está cancelando é o atribuído
      if (current.delivererJid && current.delivererJid !== delivererJid) {
        return json({ error: 'Apenas o entregador atribuído pode cancelar este pedido', currentDelivererJid: current.delivererJid });
      }

      // Volta ao status pendente, remove entregador
      const released = await db.collection('delivery_orders').findOneAndUpdate(
        { _id: id },
        {
          $set: {
            status: 'pendente',
            delivererJid: null,
            delivererName: null,
            etaMin: null,
            cancelReason: args.reason ? String(args.reason) : 'Cancelado pelo entregador',
            updatedAt: new Date(),
          },
        },
        { returnDocument: 'after' },
      );
      if (!released) return json({ error: 'Falha ao cancelar pedido' });

      // Notifica grupo de comandos do restaurante
      try {
        const r = await getRestaurant(String(released.restaurantId));
        if (r) {
          const instance = await getRestaurantInstance(r);
          const cmdJid = String((r.commandJid ?? r.commandGroupJid) ?? '').trim();
          if (cmdJid) {
            await sendToJid(instance, cmdJid, `⚠️ Entregador *${current.delivererName}* cancelou o pedido *${released.orderRef}*. Procurando novo entregador.`);
          }
          // Re-posta no grupo de entregadores
          if (r.delivererGroupJid) {
            const dlvGrp = String(r.delivererGroupJid).trim();
            const orderText = `🔄 Pedido *${released.orderRef}* disponível novamente!\n\n${formatOrderSummary(released)}\n\nQuem aceita? Responda esta mensagem.`;
            await sendToJid(instance, dlvGrp, orderText);
          }
        }
      } catch { /* best-effort */ }

      return json({ ok: true, orderRef: released.orderRef, status: 'pendente', reposted: true });
    }

    case 'delivery_list_orders': {
      const filter: Record<string, unknown> = {};
      if (args.restaurantId) filter.restaurantId = String(args.restaurantId);
      if (args.status) filter.status = String(args.status);
      if (args.delivererJid) filter.delivererJid = String(args.delivererJid);
      if (args.days) {
        const since = new Date(Date.now() - Number(args.days) * 86_400_000);
        filter.createdAt = { $gte: since };
      }
      const limit = Math.min(Number(args.limit ?? 50), 500);
      const docs = await db.collection('delivery_orders').find(filter)
        .sort({ createdAt: -1 }).limit(limit).toArray();
      return json(docs);
    }

    case 'delivery_get_order': {
      const v = String(args.orderIdOrRef);
      const filter: Record<string, unknown> = ObjectId.isValid(v) && v.length === 24
        ? { _id: new ObjectId(v) }
        : { orderRef: v };
      const doc = await db.collection('delivery_orders').findOne(filter);
      if (!doc) return json({ error: 'Pedido não encontrado' });
      return json(doc);
    }

    case 'delivery_log_settlement': {
      const doc = {
        delivererJid: String(args.delivererJid),
        delivererName: String(args.delivererName),
        type: String(args.type),
        amount: Number(args.amount),
        description: String(args.description ?? ''),
        restaurantId: args.restaurantId ? String(args.restaurantId) : null,
        restaurantName: args.restaurantName ? String(args.restaurantName) : '',
        orderId: args.orderId ? String(args.orderId) : null,
        orderRef: args.orderRef ? String(args.orderRef) : null,
        status: 'pendente' as const,
        date: new Date(),
        createdAt: new Date(),
      };
      const result = await db.collection('delivery_settlements').insertOne(doc);
      return json({ ok: true, settlementId: result.insertedId, ...doc });
    }

    case 'delivery_post_to_command_group':
    case 'delivery_post_to_deliverer_group': {
      const r = await getRestaurant(String(args.restaurantId));
      if (!r) return json({ error: 'Restaurante não encontrado' });
      const jid = name === 'delivery_post_to_command_group'
        ? String((r.commandJid ?? r.commandGroupJid) ?? '').trim()
        : String(r.delivererGroupJid ?? '').trim();
      if (!jid) return json({ error: 'JID destino não configurado no restaurante' });
      const instance = await getRestaurantInstance(r);
      const textToSend = args.message ?? args.text;
      if (!textToSend || String(textToSend).trim() === '') {
        return json({ error: 'Parâmetro "message" obrigatório e não pode ser vazio' });
      }
      const mentionedList = Array.isArray(args.mentionedList)
        ? (args.mentionedList as string[]).filter(j => j.includes('@'))
        : undefined;
      const quotedMessageId = args.quotedMessageId ? String(args.quotedMessageId) : undefined;
      const sent = await sendToJid(instance, jid, String(textToSend), mentionedList, quotedMessageId);
      const msgId = extractMessageId(sent);
      return json({ ok: true, sent, msgId });
    }

    case 'delivery_calc_fee': {
      const restaurantId = String(args.restaurantId);
      const clientAddress = String(args.clientAddress).trim();
      if (!clientAddress) return json({ error: 'clientAddress vazio' });

      const restaurant = await getRestaurant(restaurantId);
      if (!restaurant) return json({ error: `Restaurante ${restaurantId} não encontrado` });

      const originAddress = (args.originAddress ? String(args.originAddress) : (restaurant.address as string | undefined))?.trim();
      if (!originAddress) {
        return json({ error: `Restaurante "${restaurant.name}" não tem endereço cadastrado (campo 'address'). Informe originAddress ou cadastre o endereço no documento do restaurante.` });
      }

      // Google Routes API v2 — aceita endereços diretamente, sem geocoding separado
      const distanceKm = await computeRouteDistanceKm(originAddress, clientAddress);

      // Tabela de preços do negócio
      const bizId = restaurant.businessId as string | undefined;
      if (!bizId) return json({ error: 'Restaurante sem businessId' });
      const db = await getDb();
      const biz = await db.collection('businesses').findOne(
        { _id: new ObjectId(bizId) },
        { projection: { 'settings.deliveryFeeTable': 1 } },
      );
      const table = (biz?.settings?.deliveryFeeTable as Array<{ minKm: number; maxKm: number; feeEur: number }> | undefined) ?? [];
      if (!table.length) {
        return json({ error: 'Tabela de preços não configurada em business.settings.deliveryFeeTable' });
      }

      const band = table.find(b => distanceKm >= b.minKm && distanceKm <= b.maxKm);
      const feeEur = band?.feeEur ?? null;

      // Se orderId fornecido, salva a taxa no pedido
      if (args.orderId && feeEur != null) {
        try {
          await db.collection('delivery_orders').updateOne(
            { _id: new ObjectId(String(args.orderId)) },
            { $set: { deliveryFee: feeEur, updatedAt: new Date() } },
          );
        } catch { /* best-effort — não bloqueia */ }
      }

      return json({
        restaurantName: restaurant.name,
        originAddress,
        clientAddress,
        distanceKm: Math.round(distanceKm * 10) / 10,
        feeEur,
        band: band ? `${band.minKm}–${band.maxKm} km` : null,
        outOfRange: !band,
        maxKmTabela: Math.max(...table.map(b => b.maxKm)),
        savedToOrder: !!(args.orderId && feeEur != null),
      });
    }

    default:
      return json({ error: `delivery tool desconhecida: ${name}` });
  }
}
