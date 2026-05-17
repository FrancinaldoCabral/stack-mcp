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
        description: 'Envia mídia (imagem, vídeo, documento) via WhatsApp.',
        inputSchema: {
            type: 'object',
            required: ['instanceName', 'number', 'mediatype', 'media'],
            properties: {
                instanceName: { type: 'string' },
                number: { type: 'string' },
                mediatype: { type: 'string', enum: ['image', 'video', 'document'], description: 'Tipo de mídia' },
                mimetype: { type: 'string', description: 'MIME type ex: image/png, video/mp4, application/pdf' },
                media: { type: 'string', description: 'URL ou base64 da mídia' },
                caption: { type: 'string', description: 'Legenda da mídia' },
                fileName: { type: 'string', description: 'Nome do arquivo (para documentos)' },
                delay: { type: 'number', description: 'Delay em ms antes de enviar' },
                quoted: { type: 'object', description: 'Mensagem a citar: { key: { id: string } }' },
            },
        },
    },
    {
        name: 'evolution_send_audio',
        description: 'Envia áudio como mensagem de voz PTT (push-to-talk) via WhatsApp — aparece como áudio gravado.',
        inputSchema: {
            type: 'object',
            required: ['instanceName', 'number', 'audio'],
            properties: {
                instanceName: { type: 'string' },
                number: { type: 'string', description: 'Número com código do país' },
                audio: { type: 'string', description: 'URL ou base64 do arquivo de áudio (mp3, ogg, mp4)' },
                delay: { type: 'number', description: 'Delay em ms antes de enviar' },
                quoted: { type: 'object', description: 'Mensagem a citar: { key: { id: string } }' },
            },
        },
    },
    {
        name: 'evolution_send_sticker',
        description: 'Envia um sticker (figurinha) via WhatsApp.',
        inputSchema: {
            type: 'object',
            required: ['instanceName', 'number', 'sticker'],
            properties: {
                instanceName: { type: 'string' },
                number: { type: 'string' },
                sticker: { type: 'string', description: 'URL ou base64 da imagem sticker (webp preferível)' },
                delay: { type: 'number' },
                quoted: { type: 'object', description: 'Mensagem a citar: { key: { id: string } }' },
            },
        },
    },
    {
        name: 'evolution_send_location',
        description: 'Envia uma localização GPS via WhatsApp.',
        inputSchema: {
            type: 'object',
            required: ['instanceName', 'number', 'name', 'address', 'latitude', 'longitude'],
            properties: {
                instanceName: { type: 'string' },
                number: { type: 'string' },
                name: { type: 'string', description: 'Nome do local' },
                address: { type: 'string', description: 'Endereço completo' },
                latitude: { type: 'number' },
                longitude: { type: 'number' },
                delay: { type: 'number' },
                quoted: { type: 'object', description: 'Mensagem a citar: { key: { id: string } }' },
            },
        },
    },
    {
        name: 'evolution_send_contact',
        description: 'Envia um ou mais cartões de contato via WhatsApp.',
        inputSchema: {
            type: 'object',
            required: ['instanceName', 'number', 'contact'],
            properties: {
                instanceName: { type: 'string' },
                number: { type: 'string' },
                contact: {
                    type: 'array',
                    items: {
                        type: 'object',
                        required: ['fullName', 'phoneNumber'],
                        properties: {
                            fullName: { type: 'string' },
                            phoneNumber: { type: 'string' },
                            wuid: { type: 'string' },
                            organization: { type: 'string' },
                            email: { type: 'string' },
                            url: { type: 'string' },
                        },
                    },
                },
            },
        },
    },
    {
        name: 'evolution_send_reaction',
        description: 'Envia uma reação emoji em uma mensagem específica. String vazia remove a reação.',
        inputSchema: {
            type: 'object',
            required: ['instanceName', 'remoteJid', 'messageId', 'reaction'],
            properties: {
                instanceName: { type: 'string' },
                remoteJid: { type: 'string', description: 'JID do destinatário (ex: 5511999@s.whatsapp.net)' },
                fromMe: { type: 'boolean', description: 'Se a mensagem é nossa (padrão false)' },
                messageId: { type: 'string', description: 'ID da mensagem a reagir' },
                reaction: { type: 'string', description: 'Emoji (ex: 👍 ❤️ 😂) — vazio para remover' },
            },
        },
    },
    {
        name: 'evolution_send_poll',
        description: 'Cria e envia uma enquete via WhatsApp.',
        inputSchema: {
            type: 'object',
            required: ['instanceName', 'number', 'name', 'selectableCount', 'values'],
            properties: {
                instanceName: { type: 'string' },
                number: { type: 'string' },
                name: { type: 'string', description: 'Pergunta da enquete' },
                selectableCount: { type: 'number', description: 'Quantas opções o usuário pode escolher (geralmente 1)' },
                values: { type: 'array', items: { type: 'string' }, description: 'Opções da enquete (máx 12)' },
                delay: { type: 'number' },
            },
        },
    },
    {
        name: 'evolution_send_list',
        description: 'Envia um menu de lista interativo via WhatsApp.',
        inputSchema: {
            type: 'object',
            required: ['instanceName', 'number', 'title', 'description', 'buttonText', 'footerText', 'values'],
            properties: {
                instanceName: { type: 'string' },
                number: { type: 'string' },
                title: { type: 'string' },
                description: { type: 'string' },
                buttonText: { type: 'string', description: 'Texto do botão que abre a lista' },
                footerText: { type: 'string' },
                values: {
                    type: 'array',
                    description: 'Seções da lista',
                    items: {
                        type: 'object',
                        required: ['title', 'rows'],
                        properties: {
                            title: { type: 'string' },
                            rows: {
                                type: 'array',
                                items: {
                                    type: 'object',
                                    required: ['title', 'description', 'rowId'],
                                    properties: {
                                        title: { type: 'string' },
                                        description: { type: 'string' },
                                        rowId: { type: 'string' },
                                    },
                                },
                            },
                        },
                    },
                },
                delay: { type: 'number' },
            },
        },
    },
    {
        name: 'evolution_send_buttons',
        description: 'Envia uma mensagem com botões clicáveis via WhatsApp.',
        inputSchema: {
            type: 'object',
            required: ['instanceName', 'number', 'title', 'description', 'footer', 'buttons'],
            properties: {
                instanceName: { type: 'string' },
                number: { type: 'string' },
                title: { type: 'string' },
                description: { type: 'string' },
                footer: { type: 'string' },
                buttons: {
                    type: 'array',
                    items: {
                        type: 'object',
                        required: ['title', 'displayText', 'id'],
                        properties: {
                            title: { type: 'string' },
                            displayText: { type: 'string' },
                            id: { type: 'string' },
                        },
                    },
                },
                delay: { type: 'number' },
            },
        },
    },
    {
        name: 'evolution_send_status',
        description: 'Publica um status/story no WhatsApp (texto, imagem ou áudio).',
        inputSchema: {
            type: 'object',
            required: ['instanceName', 'type', 'content', 'allContacts'],
            properties: {
                instanceName: { type: 'string' },
                type: { type: 'string', enum: ['text', 'image', 'audio'] },
                content: { type: 'string', description: 'Texto ou URL/base64 da mídia' },
                caption: { type: 'string', description: 'Legenda (para imagem/áudio)' },
                backgroundColor: { type: 'string', description: 'Cor de fundo hex (ex: #008000)' },
                font: { type: 'number', description: '1=SERIF 2=NORICAN 3=BRYNDAN 4=BEBASNEUE 5=OSWALD' },
                allContacts: { type: 'boolean' },
                statusJidList: { type: 'array', items: { type: 'string' } },
            },
        },
    },
    {
        name: 'evolution_send_chunks',
        description: 'Envia múltiplas mensagens em sequência com delays entre elas, simulando digitação humana natural. Ideal para respostas de agentes — divida em pedaços curtos de texto, emojis isolados, stickers e áudios curtos.',
        inputSchema: {
            type: 'object',
            required: ['instanceName', 'number', 'chunks'],
            properties: {
                instanceName: { type: 'string' },
                number: { type: 'string' },
                delayBetween: { type: 'number', description: 'Delay padrão entre chunks em ms (padrão: 1200)' },
                chunks: {
                    type: 'array',
                    description: 'Mensagens a enviar em sequência',
                    items: {
                        type: 'object',
                        required: ['type', 'content'],
                        properties: {
                            type: {
                                type: 'string',
                                enum: ['text', 'audio', 'sticker', 'image'],
                                description: 'text=mensagem | audio=voz PTT | sticker=figurinha | image=imagem',
                            },
                            content: { type: 'string', description: 'Texto, URL ou base64' },
                            caption: { type: 'string', description: 'Legenda (para image)' },
                            delay: { type: 'number', description: 'Delay específico antes deste chunk (ms)' },
                        },
                    },
                },
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
            const { instanceName, number, mediatype, mimetype, media, caption, fileName, delay, quoted } = args;
            const payload = { number, mediatype, media };
            if (mimetype)
                payload.mimetype = mimetype;
            if (caption)
                payload.caption = caption;
            if (fileName)
                payload.fileName = fileName;
            if (delay)
                payload.delay = delay;
            if (quoted)
                payload.quoted = quoted;
            const res = await safeRequest(() => http.post(`/message/sendMedia/${instanceName}`, payload).then(r => r.data));
            return toText(res);
        }
        case 'evolution_send_audio': {
            const { instanceName, number, audio, delay, quoted } = args;
            const payload = { number, audio, delay: delay ?? 0 };
            if (quoted)
                payload.quoted = quoted;
            const res = await safeRequest(() => http.post(`/message/sendWhatsAppAudio/${instanceName}`, payload).then(r => r.data));
            return toText(res);
        }
        case 'evolution_send_sticker': {
            const { instanceName, number, sticker, delay, quoted } = args;
            const payload = { number, sticker, delay: delay ?? 0 };
            if (quoted)
                payload.quoted = quoted;
            const res = await safeRequest(() => http.post(`/message/sendSticker/${instanceName}`, payload).then(r => r.data));
            return toText(res);
        }
        case 'evolution_send_location': {
            const { instanceName, number, name, address, latitude, longitude, delay, quoted } = args;
            const payload = { number, name, address, latitude, longitude, delay: delay ?? 0 };
            if (quoted)
                payload.quoted = quoted;
            const res = await safeRequest(() => http.post(`/message/sendLocation/${instanceName}`, payload).then(r => r.data));
            return toText(res);
        }
        case 'evolution_send_contact': {
            const { instanceName, number, contact } = args;
            const res = await safeRequest(() => http.post(`/message/sendContact/${instanceName}`, { number, contact }).then(r => r.data));
            return toText(res);
        }
        case 'evolution_send_reaction': {
            const { instanceName, remoteJid, fromMe, messageId, reaction } = args;
            const payload = { key: { remoteJid, fromMe: fromMe ?? false, id: messageId }, reaction };
            const res = await safeRequest(() => http.post(`/message/sendReaction/${instanceName}`, payload).then(r => r.data));
            return toText(res);
        }
        case 'evolution_send_poll': {
            const { instanceName, number, name, selectableCount, values, delay } = args;
            const payload = { number, name, selectableCount, values, delay: delay ?? 0 };
            const res = await safeRequest(() => http.post(`/message/sendPoll/${instanceName}`, payload).then(r => r.data));
            return toText(res);
        }
        case 'evolution_send_list': {
            const { instanceName, number, title, description, buttonText, footerText, values, delay } = args;
            const payload = { number, title, description, buttonText, footerText, values, delay: delay ?? 0 };
            const res = await safeRequest(() => http.post(`/message/sendList/${instanceName}`, payload).then(r => r.data));
            return toText(res);
        }
        case 'evolution_send_buttons': {
            const { instanceName, number, title, description, footer, buttons, delay } = args;
            const payload = { number, title, description, footer, buttons, delay: delay ?? 0 };
            const res = await safeRequest(() => http.post(`/message/sendButtons/${instanceName}`, payload).then(r => r.data));
            return toText(res);
        }
        case 'evolution_send_status': {
            const { instanceName, type, content, caption, backgroundColor, font, allContacts, statusJidList } = args;
            const payload = { type, content, allContacts };
            if (caption)
                payload.caption = caption;
            if (backgroundColor)
                payload.backgroundColor = backgroundColor;
            if (font)
                payload.font = font;
            if (statusJidList)
                payload.statusJidList = statusJidList;
            const res = await safeRequest(() => http.post(`/message/sendStatus/${instanceName}`, payload).then(r => r.data));
            return toText(res);
        }
        case 'evolution_send_chunks': {
            const { instanceName, number, chunks, delayBetween } = args;
            const defaultDelay = delayBetween ?? 1200;
            const results = [];
            for (const chunk of chunks) {
                const ms = chunk.delay ?? defaultDelay;
                await new Promise(resolve => setTimeout(resolve, ms));
                let res;
                switch (chunk.type) {
                    case 'audio':
                        res = await safeRequest(() => http.post(`/message/sendWhatsAppAudio/${instanceName}`, { number, audio: chunk.content }).then(r => r.data));
                        break;
                    case 'sticker':
                        res = await safeRequest(() => http.post(`/message/sendSticker/${instanceName}`, { number, sticker: chunk.content }).then(r => r.data));
                        break;
                    case 'image':
                        res = await safeRequest(() => http.post(`/message/sendMedia/${instanceName}`, {
                            number, mediatype: 'image', media: chunk.content, caption: chunk.caption,
                        }).then(r => r.data));
                        break;
                    default: // text
                        res = await safeRequest(() => http.post(`/message/sendText/${instanceName}`, { number, text: chunk.content }).then(r => r.data));
                }
                results.push({ type: chunk.type, status: res?.status ?? 'sent' });
            }
            return toText({ data: results });
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
