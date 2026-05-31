const API_KEY = localStorage.getItem('vendly_api_key') ?? '';

export function getApiKey() {
  return localStorage.getItem('vendly_api_key') ?? '';
}

export function setApiKey(key: string) {
  localStorage.setItem('vendly_api_key', key);
}

async function req<T>(path: string, init?: RequestInit): Promise<T> {
  const key = getApiKey();
  const res = await fetch(`/api${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${key}`,
      ...init?.headers,
    },
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText })) as { error?: string };
    throw new Error(err.error ?? res.statusText);
  }
  return res.json() as Promise<T>;
}

export const api = {
  // Businesses
  getBusinesses: () => req<import('./types').Business[]>('/businesses'),
  getBusiness: (id: string) => req<import('./types').Business>(`/businesses/${id}`),
  createBusiness: (data: Partial<import('./types').Business>) =>
    req<import('./types').Business>('/businesses', { method: 'POST', body: JSON.stringify(data) }),
  updateBusiness: (id: string, data: Partial<import('./types').Business>) =>
    req<import('./types').Business>(`/businesses/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  deleteBusiness: (id: string) => req<{ ok: boolean }>(`/businesses/${id}`, { method: 'DELETE' }),
  provisionBusiness: (id: string, data: { instanceName: string }) =>
    req<import('./types').Business>(`/businesses/${id}/provision`, { method: 'POST', body: JSON.stringify(data) }),
  addInstance: (id: string, data: { instanceName: string }) =>
    req<import('./types').Business>(`/businesses/${id}/add-instance`, { method: 'POST', body: JSON.stringify(data) }),
  retryChatwoot: (id: string) =>
    req<{ ok: boolean; chatwootInboxId: number }>(`/businesses/${id}/retry-chatwoot`, { method: 'POST' }),
  getBusinessQr: (id: string, instanceName?: string) =>
    req<{ base64: string | null; code: string | null; instanceName: string }>(`/businesses/${id}/qr${instanceName ? `?instance=${encodeURIComponent(instanceName)}` : ''}`),
  getBusinessQrStatus: (id: string, instanceName?: string) =>
    req<{ status: string; instanceName?: string }>(`/businesses/${id}/qr-status${instanceName ? `?instance=${encodeURIComponent(instanceName)}` : ''}`),
  sendQrLink: (id: string, instanceName: string, email?: string) =>
    req<{ ok: boolean; connectUrl: string }>(`/businesses/${id}/qr-link`, { method: 'POST', body: JSON.stringify({ instanceName, email }) }),
  getInstancesStatus: (id: string) =>
    req<{ instanceName: string; status: string; inboxId: number | null }[]>(`/businesses/${id}/instances-status`),
  disconnectInstance: (bizId: string, instanceName: string) =>
    req<{ ok: boolean }>(`/businesses/${bizId}/instances/${encodeURIComponent(instanceName)}/disconnect`, { method: 'POST' }),

  // Agentes
  createAgent: (bizId: string, data: Partial<import('./types').Agent>) =>
    req<import('./types').Business>(`/businesses/${bizId}/agents`, { method: 'POST', body: JSON.stringify(data) }),
  updateAgent: (bizId: string, agentId: string, data: Partial<import('./types').Agent>) =>
    req<import('./types').Business>(`/businesses/${bizId}/agents/${agentId}`, { method: 'PUT', body: JSON.stringify(data) }),
  deleteAgent: (bizId: string, agentId: string) =>
    req<import('./types').Business>(`/businesses/${bizId}/agents/${agentId}`, { method: 'DELETE' }),
  assignAgent: (bizId: string, instanceName: string, agentId: string | null) =>
    req<import('./types').Business>(`/businesses/${bizId}/instances/${encodeURIComponent(instanceName)}/assign-agent`, { method: 'PUT', body: JSON.stringify({ agentId }) }),
  setAgentBot: (bizId: string, instanceName: string, enable: boolean) =>
    req<{ ok: boolean; botEnabled: boolean; inboxId: number; botId?: number }>(`/businesses/${bizId}/instances/${encodeURIComponent(instanceName)}/set-agent-bot`, { method: 'POST', body: JSON.stringify({ enable }) }),
  getChatwootStatus: (bizId: string, instanceName: string) =>
    req<{ configured: boolean; inboxId: number | null; botEnabled: boolean; agentBot?: { id: number; name: string } | null }>(`/businesses/${bizId}/instances/${encodeURIComponent(instanceName)}/chatwoot-status`),

  // Escalation notify list
  getNotifyList: (id: string) =>
    req<{ escalationNotifyList: string[] }>(`/businesses/${id}/notify-list`),
  addNotifyContact: (id: string, phone: string) =>
    req<{ escalationNotifyList: string[] }>(`/businesses/${id}/notify-list`, { method: 'POST', body: JSON.stringify({ phone, action: 'add' }) }),
  removeNotifyContact: (id: string, phone: string) =>
    req<{ escalationNotifyList: string[] }>(`/businesses/${id}/notify-list`, { method: 'POST', body: JSON.stringify({ phone, action: 'remove' }) }),

  // Contact filter
  getContactFilter: (id: string) =>
    req<{ contactFilter: import('./types').ContactFilter }>(`/businesses/${id}/contact-filter`),
  updateContactFilter: (id: string, filter: import('./types').ContactFilter) =>
    req<{ contactFilter: import('./types').ContactFilter }>(`/businesses/${id}/contact-filter`, { method: 'PUT', body: JSON.stringify(filter) }),
  getInstanceGroups: (id: string, instanceName: string) =>
    req<{ groups: import('./types').WhatsAppGroup[] }>(`/businesses/${id}/instances/${encodeURIComponent(instanceName)}/groups`),
  getInstanceContacts: (id: string, instanceName: string) =>
    req<{ contacts: import('./types').InstanceContact[] }>(`/businesses/${id}/instances/${encodeURIComponent(instanceName)}/contacts`),

  // Personas & context routes
  getPersonas: (id: string) =>
    req<{ personas: import('./types').Persona[]; contextRoutes: import('./types').ContextRoute[] }>(`/businesses/${id}/personas`),
  updatePersonas: (id: string, personas: import('./types').Persona[]) =>
    req<{ personas: import('./types').Persona[] }>(`/businesses/${id}/personas`, { method: 'PUT', body: JSON.stringify({ personas }) }),
  updateContextRoutes: (id: string, contextRoutes: import('./types').ContextRoute[]) =>
    req<{ contextRoutes: import('./types').ContextRoute[] }>(`/businesses/${id}/context-routes`, { method: 'PUT', body: JSON.stringify({ contextRoutes }) }),

  // Customers
  getCustomers: (params?: Record<string, string>) => {
    const q = params ? '?' + new URLSearchParams(params).toString() : '';
    return req<{ data: import('./types').Customer[]; total: number }>(`/customers${q}`);
  },
  getCustomer: (id: string) => req<import('./types').Customer>(`/customers/${id}`),
  updateCustomer: (id: string, data: Partial<import('./types').Customer>) =>
    req<import('./types').Customer>(`/customers/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  deleteCustomer: (id: string) => req<{ ok: boolean }>(`/customers/${id}`, { method: 'DELETE' }),

  // Conversations
  getConversations: (params?: Record<string, string>) => {
    const q = params ? '?' + new URLSearchParams(params).toString() : '';
    return req<{ data: import('./types').Conversation[]; total: number }>(`/conversations${q}`);
  },
  getConversation: (id: string) => req<import('./types').Conversation>(`/conversations/${id}`),

  // Analytics
  getAnalytics: (params?: Record<string, string>) => {
    const q = params ? '?' + new URLSearchParams(params).toString() : '';
    return req<import('./types').Analytics>(`/analytics${q}`);
  },

  // Knowledge
  getKnowledge: (params?: Record<string, string>) => {
    const q = params ? '?' + new URLSearchParams(params).toString() : '';
    return req<{ data: import('./types').KnowledgePoint[] }>(`/knowledge${q}`);
  },
  createKnowledge: (data: { title: string; text: string; category?: string; businessId: string }) =>
    req<{ id: number }>('/knowledge', { method: 'POST', body: JSON.stringify(data) }),
  updateKnowledge: (id: number, data: { title?: string; text?: string; category?: string }) =>
    req<{ ok: boolean }>(`/knowledge/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  deleteKnowledge: (id: number) => req<{ ok: boolean }>(`/knowledge/${id}`, { method: 'DELETE' }),

  // Delivery
  getDeliveryRestaurants: () => req<import('./types').DeliveryRestaurant[]>('/delivery/restaurants'),
  createDeliveryRestaurant: (data: Partial<import('./types').DeliveryRestaurant>) =>
    req<import('./types').DeliveryRestaurant>('/delivery/restaurants', { method: 'POST', body: JSON.stringify(data) }),
  updateDeliveryRestaurant: (id: string, data: Partial<import('./types').DeliveryRestaurant>) =>
    req<import('./types').DeliveryRestaurant>(`/delivery/restaurants/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  deleteDeliveryRestaurant: (id: string) => req<{ ok: boolean }>(`/delivery/restaurants/${id}`, { method: 'DELETE' }),

  getDeliveryOrders: (params?: Record<string, string>) => {
    const q = params ? '?' + new URLSearchParams(params).toString() : '';
    return req<{ data: import('./types').DeliveryOrder[]; total: number }>(`/delivery/orders${q}`);
  },
  updateDeliveryOrder: (id: string, data: Partial<import('./types').DeliveryOrder>) =>
    req<import('./types').DeliveryOrder>(`/delivery/orders/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  deleteDeliveryOrder: (id: string) =>
    req<{ ok: boolean }>(`/delivery/orders/${id}`, { method: 'DELETE' }),

  getDeliverySettlements: (params?: Record<string, string>) => {
    const q = params ? '?' + new URLSearchParams(params).toString() : '';
    return req<{ data: import('./types').DeliverySettlement[]; total: number }>(`/delivery/settlements${q}`);
  },
  createDeliverySettlement: (data: Partial<import('./types').DeliverySettlement>) =>
    req<import('./types').DeliverySettlement>('/delivery/settlements', { method: 'POST', body: JSON.stringify(data) }),
  updateDeliverySettlement: (id: string, data: Partial<import('./types').DeliverySettlement>) =>
    req<import('./types').DeliverySettlement>(`/delivery/settlements/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  deleteDeliverySettlement: (id: string) =>
    req<{ ok: boolean }>(`/delivery/settlements/${id}`, { method: 'DELETE' }),

  // Manutenção — limpeza de conversas
  clearContactConversations: (phone: string, instance?: string) => {
    const q = instance ? `?instance=${encodeURIComponent(instance)}` : '';
    return req<{ ok: boolean; phone: string; detail: string }>(`/conversations/contact/${encodeURIComponent(phone)}${q}`, { method: 'DELETE' });
  },
  clearAllConversations: () =>
    req<{ ok: boolean; detail: string }>('/conversations/all', { method: 'DELETE' }),
};

export { API_KEY };
