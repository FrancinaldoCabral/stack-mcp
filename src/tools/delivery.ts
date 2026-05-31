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

async function sendToJid(instance: string, jid: string, text: string): Promise<unknown> {
  const http = evolution();
  return safeRequest(() =>
    http.post(`/message/sendText/${instance}`, { number: jid, text, delay: 500 })
      .then(r => r.data)
  );
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
  if (order.clientName) lines.push(`Cliente: ${order.clientName}`);
  if (order.clientAddress) lines.push(`Endereço: ${order.clientAddress}`);
  if (order.clientPhone) lines.push(`Telefone: ${order.clientPhone}`);
  if (Array.isArray(order.items) && order.items.length) {
    lines.push(`Itens:\n${order.items.map((it: unknown) => `  • ${String(it)}`).join('\n')}`);
  }
  if (order.value != null) lines.push(`Valor: R$ ${Number(order.value).toFixed(2)}`);
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
    description: 'Cria um pedido em rascunho a partir das informações capturadas do entregador. NÃO posta no grupo ainda — usa-se delivery_confirm_order para liberar.',
    inputSchema: {
      type: 'object',
      required: ['restaurantId'],
      properties: {
        restaurantId: { type: 'string' },
        clientName: { type: 'string' },
        clientAddress: { type: 'string' },
        clientPhone: { type: 'string' },
        items: { type: 'array', items: { type: 'string' }, description: 'Lista de itens do pedido em texto livre' },
        value: { type: 'number', description: 'Valor do pedido em R$' },
        notes: { type: 'string', description: 'Observações livres' },
      },
    },
  },
  {
    name: 'delivery_update_draft',
    description: 'Atualiza campos de um pedido em rascunho. Não funciona em pedidos já confirmados (use delivery_update_order).',
    inputSchema: {
      type: 'object',
      required: ['orderId'],
      properties: {
        orderId: { type: 'string' },
        clientName: { type: 'string' },
        clientAddress: { type: 'string' },
        clientPhone: { type: 'string' },
        items: { type: 'array', items: { type: 'string' } },
        value: { type: 'number' },
        notes: { type: 'string' },
      },
    },
  },
  {
    name: 'delivery_confirm_order',
    description: 'Confirma um pedido em rascunho (status → "pendente") e posta resumo no grupo de comandos do restaurante. Use após o entregador confirmar todos os dados.',
    inputSchema: {
      type: 'object',
      required: ['orderId'],
      properties: {
        orderId: { type: 'string' },
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
    description: 'Atribui um entregador a um pedido e opcionalmente registra ETA.',
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
    description: 'Retorna um pedido por ID ou orderRef (LT-XXXXXX).',
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
      required: ['restaurantId', 'text'],
      properties: {
        restaurantId: { type: 'string' },
        text: { type: 'string' },
      },
    },
  },
  {
    name: 'delivery_post_to_deliverer_group',
    description: 'Envia mensagem ao grupo de entregadores do restaurante.',
    inputSchema: {
      type: 'object',
      required: ['restaurantId', 'text'],
      properties: {
        restaurantId: { type: 'string' },
        text: { type: 'string' },
      },
    },
  },
  {
    name: 'delivery_calc_fee',
    description: 'Calcula a distância de rota (em km) do restaurante até o endereço do cliente e retorna a taxa de entrega segundo a tabela de preços configurada para o negócio (business.settings.deliveryFeeTable). Usa Nominatim (OSM) para geocoding e OSRM público para roteamento — sem necessidade de chave de API.',
    inputSchema: {
      type: 'object',
      required: ['restaurantId', 'clientAddress'],
      properties: {
        restaurantId: { type: 'string', description: 'ID do restaurante de origem (delivery_restaurants._id)' },
        clientAddress: { type: 'string', description: 'Endereço completo de entrega (rua, número, cidade)' },
        originAddress: { type: 'string', description: 'Sobrepõe o endereço cadastrado do restaurante (opcional)' },
      },
    },
  },
];

// ── Geocoding + Routing (Nominatim + OSRM, ambos gratuitos sem chave) ────────
async function geocode(address: string): Promise<{ lat: number; lon: number; display: string }> {
  const url = `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(address)}&limit=1`;
  const r = await fetch(url, { headers: { 'User-Agent': 'stack-mcp/1.0 (vendly delivery)' } });
  if (!r.ok) throw new Error(`Nominatim ${r.status}`);
  const data = await r.json() as Array<{ lat: string; lon: string; display_name: string }>;
  if (!data?.[0]) throw new Error(`Endereço não encontrado: ${address}`);
  return { lat: +data[0].lat, lon: +data[0].lon, display: data[0].display_name };
}

async function routeDistanceKm(
  a: { lat: number; lon: number },
  b: { lat: number; lon: number },
): Promise<number> {
  const url = `https://router.project-osrm.org/route/v1/driving/${a.lon},${a.lat};${b.lon},${b.lat}?overview=false`;
  const r = await fetch(url);
  if (!r.ok) throw new Error(`OSRM ${r.status}`);
  const data = await r.json() as { routes?: Array<{ distance: number }> };
  const meters = data?.routes?.[0]?.distance;
  if (typeof meters !== 'number') throw new Error('OSRM não retornou rota');
  return meters / 1000;
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
      const doc: Record<string, unknown> = {
        orderRef: genOrderRef(),
        restaurantId: String(r._id),
        restaurantName: r.name,
        businessId: r.businessId ?? null,
        clientName: args.clientName ?? '',
        clientAddress: args.clientAddress ?? '',
        clientPhone: args.clientPhone ?? '',
        items: Array.isArray(args.items) ? args.items : [],
        value: args.value != null ? Number(args.value) : null,
        notes: args.notes ?? '',
        delivererJid: args.delivererJid ?? null,
        delivererName: args.delivererName ?? null,
        status,
        createdAt: now,
        updatedAt: now,
      };
      const result = await db.collection('delivery_orders').insertOne(doc);
      return json({ ok: true, orderId: result.insertedId, orderRef: doc.orderRef, status });
    }

    case 'delivery_update_draft': {
      const id = new ObjectId(String(args.orderId));
      const current = await db.collection('delivery_orders').findOne({ _id: id });
      if (!current) return json({ error: 'Pedido não encontrado' });
      if (current.status !== 'rascunho') {
        return json({ error: `Pedido não está em rascunho (status atual: ${current.status}). Use delivery_update_order_status.` });
      }
      const PATCHABLE = ['clientName', 'clientAddress', 'clientPhone', 'items', 'value', 'notes'];
      const update: Record<string, unknown> = { updatedAt: new Date() };
      for (const k of PATCHABLE) if (args[k] !== undefined) update[k] = args[k];
      const result = await db.collection('delivery_orders').findOneAndUpdate(
        { _id: id }, { $set: update }, { returnDocument: 'after' },
      );
      return json(result);
    }

    case 'delivery_confirm_order': {
      const id = new ObjectId(String(args.orderId));
      const order = await db.collection('delivery_orders').findOneAndUpdate(
        { _id: id, status: 'rascunho' },
        { $set: { status: 'pendente', updatedAt: new Date() } },
        { returnDocument: 'after' },
      );
      if (!order) return json({ error: 'Pedido não encontrado ou não está em rascunho' });
      const r = await getRestaurant(String(order.restaurantId));
      if (!r) return json({ ok: true, warning: 'Pedido confirmado, mas restaurante não encontrado para postagem' });
      const instance = await getRestaurantInstance(r);
      const text = `🆕 Novo pedido confirmado:\n\n${formatOrderSummary(order)}`;
      const cmdJid = String((r.commandJid ?? r.commandGroupJid) ?? '').trim();
      const sent: Record<string, unknown> = {};
      if (cmdJid) sent.commandGroup = await sendToJid(instance, cmdJid, text);
      if (args.crossPost && r.delivererGroupJid) {
        sent.delivererGroup = await sendToJid(instance, String(r.delivererGroupJid), text);
      }
      return json({ ok: true, orderRef: order.orderRef, sent });
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
      const notify = args.notifyCommandGroup !== false;
      if (!notify) return json({ ok: true, order });
      const r = await getRestaurant(String(order.restaurantId));
      if (!r) return json({ ok: true, order, warning: 'Restaurante não encontrado para espelhamento' });
      const cmdJid = String((r.commandJid ?? r.commandGroupJid) ?? '').trim();
      if (!cmdJid) return json({ ok: true, order, warning: 'Restaurante sem commandJid' });
      const instance = await getRestaurantInstance(r);
      const text = `📦 Pedido *${order.orderRef ?? order._id}* — status: *${status}*${note ? `\n${note}` : ''}`;
      const sent = await sendToJid(instance, cmdJid, text);
      return json({ ok: true, order, sent });
    }

    case 'delivery_assign_deliverer': {
      const id = new ObjectId(String(args.orderId));
      const update: Record<string, unknown> = {
        delivererJid: String(args.delivererJid),
        delivererName: String(args.delivererName),
        updatedAt: new Date(),
      };
      if (args.etaMin != null) update.etaMin = Number(args.etaMin);
      const result = await db.collection('delivery_orders').findOneAndUpdate(
        { _id: id }, { $set: update }, { returnDocument: 'after' },
      );
      if (!result) return json({ error: 'Pedido não encontrado' });
      return json({ ok: true, order: result });
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
      const sent = await sendToJid(instance, jid, String(args.text));
      return json({ ok: true, sent });
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

      // Geocoding + routing em paralelo (geocoding) depois rota
      const [origin, dest] = await Promise.all([
        geocode(originAddress),
        geocode(clientAddress),
      ]);
      const distanceKm = await routeDistanceKm(origin, dest);

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
      return json({
        restaurantName: restaurant.name,
        originAddress,
        clientAddress,
        distanceKm: Math.round(distanceKm * 10) / 10,
        feeEur: band?.feeEur ?? null,
        band: band ? `${band.minKm}–${band.maxKm} km` : null,
        outOfRange: !band,
        maxKmTabela: Math.max(...table.map(b => b.maxKm)),
      });
    }

    default:
      return json({ error: `delivery tool desconhecida: ${name}` });
  }
}
