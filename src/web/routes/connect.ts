import { Router } from 'express';
import axios from 'axios';
import { getRedis } from '../../tools/redis.js';
import { config } from '../../config.js';

export const connectRouter = Router();

// ── Helpers ────────────────────────────────────────────────────────────────
function htmlError(title: string, message: string): string {
  return `<!DOCTYPE html><html lang="pt-BR"><head><meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${title} — Vendly</title>
<style>body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#f5f5f5;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0}
.card{background:white;border-radius:16px;padding:40px;max-width:400px;width:100%;text-align:center;box-shadow:0 4px 24px rgba(0,0,0,.1)}
h2{color:#ff4d4f;margin:0 0 12px}p{color:#666;line-height:1.6}</style>
</head><body><div class="card"><div style="font-size:48px;margin-bottom:16px">⛔</div>
<h2>${title}</h2><p>${message}</p></div></body></html>`;
}

function htmlPage(token: string, businessName: string, qrBase64: string): string {
  const qrImgHtml = qrBase64
    ? `<img src="${qrBase64}" alt="QR Code" style="width:100%;height:100%;object-fit:contain;">`
    : `<div style="font-size:14px;color:#999;padding:20px">Aguardando QR code...</div>`;

  return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Conectar WhatsApp — ${businessName}</title>
  <style>
    *{box-sizing:border-box;margin:0;padding:0}
    body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#f5f5f5;display:flex;align-items:center;justify-content:center;min-height:100vh;padding:20px}
    .card{background:white;border-radius:16px;padding:32px;max-width:440px;width:100%;text-align:center;box-shadow:0 4px 24px rgba(0,0,0,.1)}
    .logo{font-size:24px;font-weight:700;color:#25D366;margin-bottom:4px}
    .subtitle{color:#666;font-size:14px;margin-bottom:24px}
    .qr-wrap{width:280px;height:280px;margin:0 auto 20px;background:#f9f9f9;border-radius:12px;display:flex;align-items:center;justify-content:center;overflow:hidden;border:2px solid #f0f0f0}
    .status{padding:10px 16px;border-radius:8px;font-size:14px;margin-bottom:16px}
    .status.waiting{background:#fffbe6;color:#d48806}
    .status.connected{background:#f6ffed;color:#52c41a;font-weight:600;font-size:16px}
    .instructions{text-align:left;background:#f8f8f8;border-radius:10px;padding:16px;margin-bottom:20px}
    .instructions p{font-size:14px;color:#444;margin-bottom:8px;line-height:1.5}
    .instructions p:last-child{margin-bottom:0}
    .step{font-weight:700;color:#25D366}
    .timer{font-size:13px;color:#aaa;margin-bottom:12px}
    .btn{background:none;border:1px solid #d9d9d9;color:#666;padding:8px 20px;border-radius:6px;cursor:pointer;font-size:13px;transition:.2s}
    .btn:hover{border-color:#25D366;color:#25D366}
  </style>
</head>
<body>
  <div class="card">
    <div class="logo">📱 Vendly</div>
    <div class="subtitle">Conectar WhatsApp &mdash; <strong>${businessName}</strong></div>
    <div id="status" class="status waiting">⏳ Aguardando conexão...</div>
    <div class="qr-wrap" id="qrWrap">${qrImgHtml}</div>
    <div class="instructions">
      <p><span class="step">1.</span> Abra o <strong>WhatsApp</strong> no seu celular</p>
      <p><span class="step">2.</span> Toque em <strong>Configurações → Dispositivos conectados</strong></p>
      <p><span class="step">3.</span> Toque em <strong>Conectar dispositivo</strong></p>
      <p><span class="step">4.</span> Escaneie o QR code acima com a câmera</p>
    </div>
    <p class="timer" id="timer">QR code atualiza em <strong id="countdown">30</strong>s</p>
    <button class="btn" onclick="refreshQr()">↻ Atualizar QR</button>
  </div>

  <script>
    const TOKEN = ${JSON.stringify(token)};
    let countdown = 30;
    let refreshTimer;
    let statusTimer;

    function refreshQr() {
      clearInterval(refreshTimer);
      countdown = 30;
      document.getElementById('countdown').textContent = countdown;
      document.getElementById('qrWrap').innerHTML = '<div style="font-size:13px;color:#bbb;padding:20px">Carregando...</div>';
      fetch('/connect/api/' + TOKEN + '/qr')
        .then(r => r.json())
        .then(d => {
          if (d.base64) {
            document.getElementById('qrWrap').innerHTML = '<img src="' + d.base64 + '" alt="QR Code" style="width:100%;height:100%;object-fit:contain;">';
          } else {
            document.getElementById('qrWrap').innerHTML = '<div style="font-size:13px;color:#bbb;padding:20px">QR indisponível</div>';
          }
          startCountdown();
        })
        .catch(() => startCountdown());
    }

    function startCountdown() {
      clearInterval(refreshTimer);
      countdown = 30;
      refreshTimer = setInterval(() => {
        countdown--;
        const el = document.getElementById('countdown');
        if (el) el.textContent = countdown;
        if (countdown <= 0) refreshQr();
      }, 1000);
    }

    function checkStatus() {
      fetch('/connect/api/' + TOKEN + '/status')
        .then(r => r.json())
        .then(d => {
          if (d.status === 'open') {
            clearInterval(refreshTimer);
            clearInterval(statusTimer);
            document.getElementById('status').className = 'status connected';
            document.getElementById('status').textContent = '✅ WhatsApp conectado com sucesso!';
            document.getElementById('qrWrap').innerHTML = '<div style="font-size:64px;padding:48px">✅</div>';
            const timerEl = document.getElementById('timer');
            if (timerEl) timerEl.style.display = 'none';
          }
        })
        .catch(() => {});
    }

    startCountdown();
    statusTimer = setInterval(checkStatus, 5000);
    checkStatus();
  </script>
</body>
</html>`;
}

// ── Routes ─────────────────────────────────────────────────────────────────

// GET /connect/api/:token/qr — fresh QR (AJAX, must be before /:token)
connectRouter.get('/api/:token/qr', async (req, res) => {
  const redis = getRedis();
  const raw = await redis.get(`qr_link:${req.params.token}`);
  if (!raw) return res.status(404).json({ error: 'expired' });
  const { instanceName } = JSON.parse(raw) as { instanceName: string };
  try {
    const r = await axios.get(`${config.evolution.url}/instance/connect/${instanceName}`, {
      headers: { apikey: config.evolution.apiKey },
    });
    res.json({ base64: r.data?.base64 ?? null, code: r.data?.code ?? null });
  } catch {
    res.status(500).json({ error: 'qr_not_available' });
  }
});

// GET /connect/api/:token/status — connection state (AJAX)
connectRouter.get('/api/:token/status', async (req, res) => {
  const redis = getRedis();
  const raw = await redis.get(`qr_link:${req.params.token}`);
  if (!raw) return res.json({ status: 'expired' });
  const { instanceName } = JSON.parse(raw) as { instanceName: string };
  try {
    const r = await axios.get(`${config.evolution.url}/instance/connectionState/${instanceName}`, {
      headers: { apikey: config.evolution.apiKey },
    });
    const state: string = r.data?.instance?.state ?? r.data?.state ?? 'unknown';
    res.json({ status: state });
  } catch {
    res.json({ status: 'unknown' });
  }
});

// GET /connect/:token — HTML page for QR connection
connectRouter.get('/:token', async (req, res) => {
  const { token } = req.params;
  const redis = getRedis();
  try {
    const raw = await redis.get(`qr_link:${token}`);
    if (!raw) {
      return res.status(410).send(
        htmlError('Link inválido ou expirado', 'Este link de conexão não existe ou já expirou. Solicite um novo link ao administrador.'),
      );
    }
    const { instanceName, businessName } = JSON.parse(raw) as { instanceName: string; businessName: string };

    let qrBase64 = '';
    try {
      const r = await axios.get(`${config.evolution.url}/instance/connect/${instanceName}`, {
        headers: { apikey: config.evolution.apiKey },
      });
      qrBase64 = r.data?.base64 ?? '';
    } catch { /* instance may not be ready yet */ }

    return res.send(htmlPage(token, businessName, qrBase64));
  } catch (e) {
    return res.status(500).send(htmlError('Erro interno', String(e)));
  }
});
