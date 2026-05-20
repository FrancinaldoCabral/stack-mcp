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


};

export { API_KEY };
