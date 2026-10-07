// Google Sheets connection via Apps Script Webhook (independent of Replit)
import { db } from './db';
import { clientes } from '@shared/schema';
import { eq } from 'drizzle-orm';

export interface ClienteFromSheet {
  nombre: string;
}

export async function getClientesFromSheet(): Promise<ClienteFromSheet[]> {
  const webhookUrl = process.env.APPS_SCRIPT_EMAIL_URL;
  if (!webhookUrl) {
    console.log('[Google Sheets] APPS_SCRIPT_EMAIL_URL no configurada');
    return [];
  }

  try {
    const response = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'getClientes' }),
      redirect: 'follow',
    });

    if (!response.ok) {
      console.warn(`[Google Sheets] Apps Script respondió con status ${response.status}`);
      return [];
    }

    const data = await response.json();
    if (!data || !Array.isArray(data.clientes)) {
      return [];
    }

    const sheetClientes: ClienteFromSheet[] = [];
    const seenNames = new Set<string>();

    for (const c of data.clientes) {
      const nombre = (c.nombre || '').toString().trim();
      if (!nombre) continue;

      const normalized = nombre.toLowerCase();
      if (!seenNames.has(normalized)) {
        seenNames.add(normalized);
        sheetClientes.push({ nombre });
      }
    }

    console.log(`[Google Sheets] Clientes válidos obtenidos: ${sheetClientes.length}`);
    return sheetClientes;
  } catch (error) {
    console.error('[Google Sheets] Error reading clientes from Apps Script:', error);
    return [];
  }
}

export async function syncClientesFromSheet(): Promise<{ added: number; reactivated: number; total: number; totalInDb: number }> {
  const sheetClientes = await getClientesFromSheet();
  if (sheetClientes.length === 0) {
    console.log('[Sync] No clientes found in Google Sheet, skipping sync');
    const existing = await db.select().from(clientes);
    return { added: 0, reactivated: 0, total: 0, totalInDb: existing.length };
  }

  const existingClientes = await db.select().from(clientes);
  const existingNames = new Set(existingClientes.map(c => c.nombre.toLowerCase().trim()));

  let added = 0;
  let reactivated = 0;
  for (const sc of sheetClientes) {
    const normalizedName = sc.nombre.toLowerCase().trim();
    if (!existingNames.has(normalizedName)) {
      await db.insert(clientes).values({ nombre: sc.nombre.trim(), active: true });
      existingNames.add(normalizedName);
      added++;
    } else {
      const existing = existingClientes.find(c => c.nombre.toLowerCase().trim() === normalizedName);
      if (existing && !existing.active) {
        await db.update(clientes).set({ active: true }).where(eq(clientes.id, existing.id));
        reactivated++;
      }
    }
  }

  const totalInDb = await db.select().from(clientes);
  console.log(`[Sync] Completado: ${added} nuevos, ${reactivated} reactivados, ${sheetClientes.length} en sheet, ${totalInDb.length} en DB`);
  return { added, reactivated, total: sheetClientes.length, totalInDb: totalInDb.length };
}
