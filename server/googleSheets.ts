// Google Sheets connection via Replit connectors SDK (integration: google-sheet)
import { ReplitConnectors } from '@replit/connectors-sdk';
import { db } from './db';
import { clientes } from '@shared/schema';
import { eq } from 'drizzle-orm';

const connectors = new ReplitConnectors();

async function getSheetValues(spreadsheetId: string, range: string): Promise<string[][] | undefined> {
  const response = await connectors.proxy(
    'google-sheet',
    `/v4/spreadsheets/${spreadsheetId}/values/${encodeURIComponent(range)}`,
    { method: 'GET' }
  );
  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Google Sheets API error ${response.status}: ${body.slice(0, 300)}`);
  }
  const data = await response.json();
  return data.values;
}

const SPREADSHEET_ID = process.env.GOOGLE_SHEET_ID || '';
const BD_CLIENTES_SHEET = 'BD Cliente';

export interface ClienteFromSheet {
  nombre: string;
}

export async function getClientesFromSheet(): Promise<ClienteFromSheet[]> {
  if (!SPREADSHEET_ID) {
    console.log('Google Sheet ID not configured');
    return [];
  }

  try {
    // Solo leer columna A (nombres de clientes)
    const rows = await getSheetValues(SPREADSHEET_ID, `'${BD_CLIENTES_SHEET}'!A:A`);
    if (!rows || rows.length === 0) {
      console.log('No data found in BD Clientes sheet');
      return [];
    }

    const sheetClientes: ClienteFromSheet[] = [];
    const seenNames = new Set<string>();
    let emptyRows = 0;
    let duplicateRows = 0;

    // Empezar desde fila 1 (saltar encabezado si existe)
    for (let i = 1; i < rows.length; i++) {
      const row = rows[i];
      if (!row || row.length === 0) {
        emptyRows++;
        continue;
      }
      
      const nombre = row[0]?.toString().trim();
      if (!nombre) {
        emptyRows++;
        continue;
      }

      const normalizedName = nombre.toLowerCase();
      if (seenNames.has(normalizedName)) {
        duplicateRows++;
        console.log(`[Google Sheets] Duplicate in row ${i + 1}: "${nombre}"`);
        continue;
      }

      seenNames.add(normalizedName);
      sheetClientes.push({ nombre });
    }

    console.log(`[Google Sheets] Total rows: ${rows.length - 1}, Valid clientes: ${sheetClientes.length}, Empty rows: ${emptyRows}, Duplicates: ${duplicateRows}`);
    return sheetClientes;
  } catch (error) {
    console.error('Error reading clientes from Google Sheets:', error);
    throw error;
  }
}

export async function syncClientesFromSheet(): Promise<{ added: number; reactivated: number; total: number; totalInDb: number }> {
  const sheetClientes = await getClientesFromSheet();
  if (sheetClientes.length === 0) {
    console.log('[Sync] No clientes found in Google Sheet, skipping sync');
    return { added: 0, reactivated: 0, total: 0, totalInDb: 0 };
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
