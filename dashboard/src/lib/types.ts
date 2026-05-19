// Tipos compartilhados com o backend

export interface Business {
  _id: string;
  name: string;
  instances: string[];
  assistantName: string;
  systemPrompt: string;
  settings: {
    model: string;
    maxHistoryTokens: number;
    tools: { searchMemory: boolean };
  };
  instanceInboxes?: Record<string, number>;
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
