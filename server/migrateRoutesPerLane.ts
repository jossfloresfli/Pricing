import { db } from "./db";
import { pricingRequests } from "@shared/schema";
import { eq } from "drizzle-orm";
import { log } from "./index";

export async function migrateRoutesPerLane() {
  try {
    const rows = await db.select().from(pricingRequests);
    let migratedCount = 0;

    for (const row of rows) {
      let rutas: any[] = [];
      try {
        rutas = JSON.parse(row.rutas || "[]");
      } catch {
        continue;
      }
      if (!Array.isArray(rutas) || rutas.length === 0) continue;

      const reqCruce = row.requiereCruce;
      const reqCiudad = row.ciudadCruce;

      const needsNormalization = rutas.some(
        (r) =>
          r.requiereCruce === undefined ||
          r.ciudadCruce === undefined ||
          r.stops === undefined,
      );
      const hasLegacyTopLevel = (reqCruce || reqCiudad) &&
        rutas[0].requiereCruce === undefined &&
        rutas[0].ciudadCruce === undefined;

      if (!needsNormalization && !hasLegacyTopLevel) continue;

      rutas = rutas.map((r, idx) => {
        const inheritCruce = idx === 0 && hasLegacyTopLevel ? reqCruce || false : undefined;
        const inheritCiudad = idx === 0 && hasLegacyTopLevel ? reqCiudad || "" : undefined;
        return {
          ...r,
          requiereCruce: r.requiereCruce ?? inheritCruce ?? false,
          ciudadCruce: r.ciudadCruce ?? inheritCiudad ?? "",
          stops: Array.isArray(r.stops) ? r.stops : [],
        };
      });

      await db
        .update(pricingRequests)
        .set({ rutas: JSON.stringify(rutas) })
        .where(eq(pricingRequests.id, row.id));
      migratedCount++;
    }

    if (migratedCount > 0) {
      log(`Migración per-route cruce: ${migratedCount} cotizaciones actualizadas`);
    }
  } catch (err) {
    log(
      `Error en migración per-route cruce: ${err instanceof Error ? err.message : "Error desconocido"}`,
    );
  }
}
