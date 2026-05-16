import { config } from '../config.js';
import { createClient, safeRequest, toText } from '../utils/http.js';
const client = () => createClient(config.evolution.url, {
    apikey: config.evolution.apiKey,
    'Content-Type': 'application/json',
});
export const evolutionTools = [
    {
        name: 'evolution_list_instances',
        description: 'Lista todas as instâncias do WhatsApp configuradas na Evolution API com status de conexão.',
        inputSchema: { type: 'object', properties: {} },
    },
    {
        name: 'evolution_create_instance',
        description: 'Cria uma nova instância do WhatsApp na Evolution API.',
        inputSchema: {
            type: 'object',
            required: ['instanceName'],
            properties: {
                instanceName: { type: 'string', description: 'Nome único da instância' },
                token: { type: 'string', description: 'Token opcional para a instância' },
                qrcode: { type: 'boolean', description: 'Gerar QR code automaticamente (padrão true)' },
                integration: {
                    type: 'string',
                    enum: ['WHATSAPP-BAILEYS', 'WHATSAPP-BUSINESS'],
                    description: 'Tipo de integração',
                },
                webhook: { type: 'string', description: 'URL do webhook para esta instância' },
                webhookByEvents: { type: 'boolean', description: 'Webhook por eventos separados' },
                chatwootAccountId: { type: 'string', description: 'ID da conta Chatwoot para integração' },
                chatwootToken: { type: 'string', description: 'Token Chatwoot para integração' },
            },
        },
    },
    {
        name: 'evolution_get_instance',
        description: 'Obtém status e informações de uma instância específica.',
        inputSchema: {
            type: 'object',
            required: ['instanceName'],
            properties: { instanceName: { type: 'string' } },
        },
    },
    {
        name: 'evolution_delete_instance',
        description: 'Remove uma instância da Evolution API.',
        inputSchema: {
            type: 'object',
            required: ['instanceName'],
            properties: { instanceName: { type: 'string' } },
        },
    },
    {
        name: 'evolution_get_qrcode',
        description: 'Obtém o QR code de conexão para uma instância desconectada.',
        inputSchema: {
            type: 'object',
            required: ['instanceName'],
            properties: { instanceName: { type: 'string' } },
        },
    },
    {
        name: 'evolution_send_text',
        description: 'Envia uma mensagem de texto via WhatsApp por uma instância.',
        inputSchema: {
            type: 'object',
            required: ['instanceName', 'number', 'text'],
            properties: {
                instanceName: { type: 'string' },
                number: { type: 'string', description: 'Número do destinatário com código do país (ex: 5511999999999)' },
                text: { type: 'string', description: 'Texto da mensagem' },
                delay: { type: 'number', description: 'Delay em ms antes de enviar' },
            },
        },
    },
    {
        name: 'evolution_send_media',
        description: 'Envia mídia (imagem, vídeo, áudio, documento) via WhatsApp.',
        inputSchema: {
            type: 'object',
            required: ['instanceName', 'number', 'mediatype', 'media'],
            properties: {
                instanceName: { type: 'string' },
                number: { type: 'string' },
                mediatype: { type: 'string', enum: ['image', 'video', 'audio', 'document'] },
                media: { type: 'string', description: 'URL ou base64 da mídia' },
                caption: { type: 'string', description: 'Legenda da mídia' },
                fileName: { type: 'string', description: 'Nome do arquivo (para documentos)' },
            },
        },
    },
    {
        name: 'evolution_set_webhook',
        description: 'Configura ou atualiza o webhook de uma instância.',
        inputSchema: {
            type: 'object',
            required: ['instanceName', 'url'],
            properties: {
                instanceName: { type: 'string' },
                url: { type: 'string', description: 'URL do webhook' },
                enabled: { type: 'boolean', description: 'Habilitar/desabilitar webhook' },
                events: {
                    type: 'array',
                    items: { type: 'string' },
                    description: 'Lista de eventos para escutar (ex: ["MESSAGES_UPSERT", "CONNECTION_UPDATE"])',
                },
            },
        },
    },
    {
        name: 'evolution_logout_instance',
        description: 'Desconecta (logout) uma instância do WhatsApp.',
        inputSchema: {
            type: 'object',
            required: ['instanceName'],
            properties: { instanceName: { type: 'string' } },
        },
    },
    {
        name: 'evolution_restart_instance',
        description: 'Reinicia uma instância da Evolution API.',
        inputSchema: {
            type: 'object',
            required: ['instanceName'],
            properties: { instanceName: { type: 'string' } },
        },
    },
];
export async function handleEvolutionTool(name, args) {
    const http = client();
    switch (name) {
        case 'evolution_list_instances': {
            const res = await safeRequest(() => http.get('/instance/fetchInstances').then(r => r.data));
            return toText(res);
        }
        case 'evolution_create_instance': {
            const { instanceName, ...rest } = args;
            const payload = { instanceName, qrcode: true, ...rest };
            const res = await safeRequest(() => http.post('/instance/create', payload).then(r => r.data));
            return toText(res);
        }
        case 'evolution_get_instance': {
            const res = await safeRequest(() => http.get(`/instance/fetchInstances?instanceName=${args.instanceName}`).then(r => r.data));
            return toText(res);
        }
        case 'evolution_delete_instance': {
            const res = await safeRequest(() => http.delete(`/instance/delete/${args.instanceName}`).then(r => r.data));
            return toText(res);
        }
        case 'evolution_get_qrcode': {
            const res = await safeRequest(() => http.get(`/instance/qrcode/${args.instanceName}?image=true`).then(r => r.data));
            return toText(res);
        }
        case 'evolution_send_text': {
            const { instanceName, number, text, delay } = args;
            const payload = {
                number,
                text,
                delay: delay ?? 0,
            };
            const res = await safeRequest(() => http.post(`/message/sendText/${instanceName}`, payload).then(r => r.data));
            return toText(res);
        }
        case 'evolution_send_media': {
            const { instanceName, number, mediatype, media, caption, fileName } = args;
            const payload = { number, mediatype, media, caption, fileName };
            const res = await safeRequest(() => http.post(`/message/sendMedia/${instanceName}`, payload).then(r => r.data));
            return toText(res);
        }
        case 'evolution_set_webhook': {
            const { instanceName, url, enabled, events } = args;
            const payload = {
                url,
                enabled: enabled ?? true,
                events: events ?? ['MESSAGES_UPSERT', 'CONNECTION_UPDATE', 'MESSAGES_UPDATE'],
            };
            const res = await safeRequest(() => http.post(`/webhook/set/${instanceName}`, payload).then(r => r.data));
            return toText(res);
        }
        case 'evolution_logout_instance': {
            const res = await safeRequest(() => http.delete(`/instance/logout/${args.instanceName}`).then(r => r.data));
            return toText(res);
        }
        case 'evolution_restart_instance': {
            const res = await safeRequest(() => http.put(`/instance/restart/${args.instanceName}`).then(r => r.data));
            return toText(res);
        }
        default:
            return `❌ Ferramenta desconhecida: ${name}`;
    }
}
