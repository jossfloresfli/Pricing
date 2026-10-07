// Envío de correos via Google Apps Script Web App (webhook).
// El Apps Script recibe un POST con los datos y usa MailApp.sendEmail() de Google.
// Variable requerida: APPS_SCRIPT_EMAIL_URL (URL de publicación del script como Web App).
// Migrado desde Resend/Replit Connectors — ahora independiente de plataforma.

interface NotificationEmailParams {
  to: string;
  userName: string;
  title: string;
  message: string;
  type: string;
  requestId?: string;
}

function getEmailTemplate(params: NotificationEmailParams): string {
  const { type, requestId } = params;
  const escapeHtml = (value: string) =>
    value
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  const userName = escapeHtml(params.userName);
  const title = escapeHtml(params.title);
  const message = escapeHtml(params.message).replace(/\n/g, '<br>');
  const safeRequestId = requestId ? escapeHtml(requestId) : undefined;
  
  const typeColors: Record<string, string> = {
    status_change: '#3B82F6',
    new_request: '#0EA5E9',
    new_offer: '#10B981',
    offer_selected: '#8B5CF6',
    comment: '#F59E0B',
    mention: '#D97706',
    info: '#6B7280',
  };
  
  const color = typeColors[type] || typeColors.info;
  
  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${title}</title>
</head>
<body style="margin: 0; padding: 0; background-color: #f3f4f6; font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;">
  <table role="presentation" style="width: 100%; border-collapse: collapse;">
    <tr>
      <td align="center" style="padding: 40px 20px;">
        <table role="presentation" style="width: 100%; max-width: 600px; border-collapse: collapse; background-color: #ffffff; border-radius: 8px; overflow: hidden; box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1);">
          <tr>
            <td style="background: linear-gradient(135deg, ${color}, ${color}dd); padding: 30px; text-align: center;">
              <h1 style="margin: 0; color: #ffffff; font-size: 24px; font-weight: 600;">VAX Pricing Hub</h1>
            </td>
          </tr>
          <tr>
            <td style="padding: 30px;">
              <p style="margin: 0 0 15px 0; color: #374151; font-size: 16px;">Hola ${userName},</p>
              <h2 style="margin: 0 0 15px 0; color: #111827; font-size: 20px; font-weight: 600;">${title}</h2>
              <p style="margin: 0 0 20px 0; color: #4B5563; font-size: 16px; line-height: 1.5;">${message}</p>
              ${safeRequestId ? `
              <div style="background-color: #f9fafb; border-radius: 6px; padding: 15px; margin-top: 20px;">
                <p style="margin: 0; color: #6B7280; font-size: 14px;">
                  <strong>ID de Cotizacion:</strong> #${safeRequestId}
                </p>
              </div>
              ` : ''}
              <div style="margin-top: 30px; padding-top: 20px; border-top: 1px solid #e5e7eb;">
                <p style="margin: 0; color: #9CA3AF; font-size: 12px; text-align: center;">
                  Este es un mensaje automatico del sistema VAX Pricing Hub.
                </p>
              </div>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>
  `.trim();
}

export async function sendNotificationEmail(params: NotificationEmailParams): Promise<boolean> {
  const webhookUrl = process.env.APPS_SCRIPT_EMAIL_URL;
  if (!webhookUrl) {
    console.warn('[Email] APPS_SCRIPT_EMAIL_URL no configurada, correo omitido');
    return false;
  }

  try {
    const html = getEmailTemplate(params);
    const response = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        to: params.to,
        subject: `[VAX Pricing Hub] ${params.title}`,
        html,
        // También enviamos texto plano como fallback para el script
        text: `${params.title}\n\n${params.message}${params.requestId ? `\n\nID de Cotización: #${params.requestId}` : ''}`,
      }),
      redirect: 'follow',
    });

    if (!response.ok) {
      console.error('[Email] Apps Script respondió con error:', response.status);
      return false;
    }

    console.log('[Email] Correo enviado via Apps Script a:', params.to);
    return true;
  } catch (error) {
    console.error('[Email] Error al llamar Apps Script webhook:', error);
    return false;
  }
}

export async function testEmailConnection(): Promise<boolean> {
  const webhookUrl = process.env.APPS_SCRIPT_EMAIL_URL;
  if (!webhookUrl) {
    console.warn('[Email] APPS_SCRIPT_EMAIL_URL no configurada');
    return false;
  }
  return true;
}
