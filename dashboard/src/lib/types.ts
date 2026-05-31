// Tipos compartilhados com o backend

export interface Agent {
  _id: string;
  name: string;          // ex: "Suporte", "Vendas"
  assistantName: string; // ex: "Ana", "Carlos"
  systemPrompt: string;
  model: string;         // OpenRouter model ID
  settings: {
    maxHistoryTokens: number;
    tools: { searchMemory: boolean };
  };
  createdAt: string;
  updatedAt: string;
}

export interface Business {
  _id: string;
  name: string;
  instances: string[];
  agents: Agent[];
  instanceAgents: Record<string, string>;   // instanceName → agent._id
  instanceInboxes?: Record<string, number>; // instanceName → chatwootInboxId
  escalationNotifyList?: string[];            // números que recebem WA quando bot escala
  contactFilter?: ContactFilter;
  personas?: Persona[];
  contextRoutes?: ContextRoute[];
  settings?: BusinessSettings;
  createdAt: string;
  updatedAt: string;
}

export interface DeliveryFeeBand {
  minKm: number;
  maxKm: number;
  feeEur: number;
}

export interface BusinessSettings {
  model?: string;
  maxHistoryTokens?: number;
  tools?: { searchMemory?: boolean };
  deliveryFeeTable?: DeliveryFeeBand[];
}

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

export interface InstanceContact {
  id: string;   // JID (5511...@s.whatsapp.net)
  name: string;
}

export interface ContactFilter {
  mode: 'blacklist' | 'whitelist';
  contacts: string[]; // dígitos
  groups: string[];   // JIDs @g.us
}

export interface WhatsAppGroup {
  id: string;       // JID @g.us
  subject: string;  // nome
  size: number;     // participantes
}

export interface Customer {
  _id: string;
  businessId: string;
  phone: string;
  name?: string;
  conversation_count?: number;
  last_seen?: string;
  profile?: { notes?: string };
  createdAt: string;
}

export interface Conversation {
  _id: string;
  businessId: string;
  customerId?: string;
  instance: string;
  phone: string;
  started_at: string;
  message_count?: number;
  model_used?: string;
  messages?: Message[];
}

export interface Message {
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp?: string;
}

export interface KnowledgePoint {
  id: number;
  payload: {
    title: string;
    text: string;
    category: string;
    businessId: string;
    customerId?: string;
    createdAt: string;
  };
}

export interface DeliveryRestaurant {
  _id: string;
  name: string;
  businessId?: string | null;
  /** JID novo (grupo ou contato individual). */
  commandJid?: string;
  /** Indica se commandJid é grupo. */
  commandIsGroup?: boolean;
  /** Legado — mantido em sincronia com commandJid. */
  commandGroupJid: string;
  delivererGroupJid: string;
  /** Endereço completo do restaurante (usado por delivery_calc_fee). */
  address?: string;
  active: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface DeliveryOrder {
  _id: string;
  restaurantId: string;
  restaurantName: string;
  orderNumber?: number;
  clientName?: string;
  clientAddress?: string;
  clientPhone?: string;
  items?: string;
  value?: number;
  delivererJid?: string;
  delivererName?: string;
  status: 'pendente' | 'atribuido' | 'a_caminho' | 'no_restaurante' | 'saindo' | 'no_cliente' | 'entregue' | 'problema';
  settlement?: 'acertado' | 'sem_acertar' | 'pendente';
  timestamps?: Record<string, string>;
  createdAt: string;
}

export interface DeliverySettlement {
  _id: string;
  delivererJid: string;
  delivererName: string;
  orderId?: string;
  orderRef?: string;
  restaurantId?: string;
  restaurantName?: string;
  date: string;
  type: 'debito' | 'credito';
  amount: number;
  description: string;
  status: 'pendente' | 'liquidado';
  createdAt: string;
}

export interface Analytics {
  summary: {
    totalBusinesses: number;
    totalCustomers: number;
    totalConversations: number;
    recentConversations: number;
    recentCustomers: number;
    period: string;
  };
  dailyStats: { _id: string; conversations: number; messages: number }[];
  topCustomers: Customer[];
  modelUsage: { _id: string; count: number }[];
}
