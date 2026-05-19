import nodemailer from 'nodemailer';
import { config } from '../config.js';

function getTransporter() {
  return nodemailer.createTransport({
    host: config.smtp.host,
    port: config.smtp.port,
    secure: false, // STARTTLS
    auth: {
      user: config.smtp.user,
      pass: config.smtp.password,
    },
  });
}

export async function sendQrLinkEmail(
  to: string,
  connectUrl: string,
  businessName: string,
): Promise<void> {
  const transporter = getTransporter();

  const html = `
<!DOCTYPE html>
<html lang="pt-BR">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background:#f5f5f5; padding:32px; margin:0;">
  <div style="max-width:520px; margin:0 auto; background:white; border-radius:12px; overflow:hidden; box-shadow:0 2px 12px rgba(0,0,0,0.08);">
    <div style="background:#25D366; padding:24px 32px;">
      <h1 style="color:white; margin:0; font-size:22px;">📱 Conectar WhatsApp</h1>
      <p style="color:rgba(255,255,255,0.85); margin:8px 0 0; font-size:14px;">${businessName}</p>
    </div>
    <div style="padding:32px;">
      <p style="color:#333; font-size:16px; line-height:1.6; margin:0 0 24px;">
        Você foi convidado para conectar seu WhatsApp ao sistema <strong>${businessName}</strong>.
      </p>
      <p style="color:#666; font-size:14px; margin:0 0 24px;">
        Clique no botão abaixo para abrir a página de conexão e escaneie o QR code com seu celular.
      </p>
      <div style="text-align:center; margin:32px 0;">
        <a href="${connectUrl}"
           style="background:#25D366; color:white; padding:14px 32px; border-radius:8px; text-decoration:none; font-size:16px; font-weight:600; display:inline-block;">
          Abrir QR Code →
        </a>
      </div>
      <p style="color:#999; font-size:12px; margin:24px 0 0; padding-top:16px; border-top:1px solid #f0f0f0;">
        ⏰ Este link expira em <strong>24 horas</strong>. Se precisar de um novo link, entre em contato com o administrador.
      </p>
    </div>
  </div>
</body>
</html>
  `.trim();

  await transporter.sendMail({
    from: `"Vendly" <${config.smtp.from}>`,
    to,
    subject: `Conectar WhatsApp — ${businessName}`,
    html,
    text: `Conectar WhatsApp — ${businessName}\n\nAcesse o link para escanear o QR code:\n${connectUrl}\n\nEste link expira em 24 horas.`,
  });
}
