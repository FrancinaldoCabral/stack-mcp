// Resolve qual persona aplicar a esta mensagem com base em persona_routes:{instance}.
// IMPORTANTE: Redis GET typeVersion 1 substitui o item por {persona_raw: ...} - restaura
// o item original via $('Desembalar Payload').first().json (mesmo padr�o de "Aplicar Filtro Contatos").
// Sem rotas configuradas = nada acontece (compatibilidade total com fluxo antigo).
const item = $('Desembalar Payload').first().json;
const raw = $input.first().json?.persona_raw ?? null;

if (!raw) return [{ json: item }];

let cfg = null;
try { cfg = JSON.parse(String(raw)); } catch { cfg = null; }
if (!cfg || !Array.isArray(cfg.routes)) return [{ json: item }];

const remoteJid = String(item.remoteJid || '');
const telefone = String(item.telefone || '');
const route = cfg.routes.find(r => r.jid === remoteJid)
  || cfg.routes.find(r => r.jid === telefone)
  || null;

if (!route) return [{ json: item }];

const personas = cfg.personas || {};
const persona = personas[route.personaKey] || null;

return [{
  json: {
    ...item,
    personaKey: route.personaKey,
    personaLabel: persona?.label ?? route.personaKey,
    systemPromptOverride: persona?.systemPrompt ?? '',
    toolsAllowed: Array.isArray(persona?.tools) ? persona.tools : [],
    restaurantId: route.restaurantId ?? null,
  },
}];

