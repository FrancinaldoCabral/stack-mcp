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
  createdAt: string;
  updatedAt: string;
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
