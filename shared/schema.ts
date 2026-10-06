import { sql } from "drizzle-orm";
import { pgTable, text, varchar, boolean, timestamp, numeric, integer, json, jsonb, index, uniqueIndex, doublePrecision } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

export const userRoles = [
  "carrier_rep",
  "carrier_lead",
  "carrier_manager",
  "sales_rep",
  "sales_lead",
  "sales_manager",
  "pricing",
  "superadmin",
] as const;

export type UserRole = (typeof userRoles)[number];

// Tabla de sesiones de connect-pg-simple (server/index.ts). Se declara aquí
// SOLO para que drizzle-kit push no intente borrarla; el store la administra.
export const session = pgTable(
  "session",
  {
    sid: varchar("sid").primaryKey(),
    sess: json("sess").notNull(),
    expire: timestamp("expire", { precision: 6, mode: "date" }).notNull(),
  },
  (table) => [index("IDX_session_expire").on(table.expire)],
);

export const users = pgTable("users", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  username: text("username").notNull().unique(),
  password: text("password").notNull(),
  plainPassword: text("plain_password"),
  name: text("name").notNull(),
  email: text("email"),
  role: text("role").notNull().default("sales_rep"),
  active: boolean("active").notNull().default(true),
  createdAt: timestamp("created_at").defaultNow(),
});

export const insertUserSchema = createInsertSchema(users).omit({
  id: true,
  createdAt: true,
});

export type InsertUser = z.infer<typeof insertUserSchema>;
export type User = typeof users.$inferSelect;

export const clientes = pgTable("clientes", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  nombre: text("nombre").notNull(),
  rfc: text("rfc"),
  active: boolean("active").notNull().default(true),
});

export const insertClienteSchema = createInsertSchema(clientes).omit({ id: true });
export type InsertCliente = z.infer<typeof insertClienteSchema>;
export type Cliente = typeof clientes.$inferSelect;

export const prospectos = pgTable("prospectos", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  nombre: text("nombre").notNull(),
  empresa: text("empresa"),
  active: boolean("active").notNull().default(true),
});

export const insertProspectoSchema = createInsertSchema(prospectos).omit({ id: true });
export type InsertProspecto = z.infer<typeof insertProspectoSchema>;
export type Prospecto = typeof prospectos.$inferSelect;

export const salesReps = pgTable("sales_reps", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  nombre: text("nombre").notNull(),
  email: text("email"),
  active: boolean("active").notNull().default(true),
});

export const insertSalesRepSchema = createInsertSchema(salesReps).omit({ id: true });
export type InsertSalesRep = z.infer<typeof insertSalesRepSchema>;
export type SalesRep = typeof salesReps.$inferSelect;

export const divisiones = pgTable("divisiones", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  nombre: text("nombre").notNull(),
  active: boolean("active").notNull().default(true),
});

export const insertDivisionSchema = createInsertSchema(divisiones).omit({ id: true });
export type InsertDivision = z.infer<typeof insertDivisionSchema>;
export type Division = typeof divisiones.$inferSelect;

export const tiposEquipo = pgTable("tipos_equipo", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  nombre: text("nombre").notNull(),
  descripcion: text("descripcion"),
  active: boolean("active").notNull().default(true),
});

export const insertTipoEquipoSchema = createInsertSchema(tiposEquipo).omit({ id: true });
export type InsertTipoEquipo = z.infer<typeof insertTipoEquipoSchema>;
export type TipoEquipo = typeof tiposEquipo.$inferSelect;

export const accesorios = pgTable("accesorios", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  nombre: text("nombre").notNull(),
  descripcion: text("descripcion"),
  active: boolean("active").notNull().default(true),
});

export const insertAccesorioSchema = createInsertSchema(accesorios).omit({ id: true });
export type InsertAccesorio = z.infer<typeof insertAccesorioSchema>;
export type Accesorio = typeof accesorios.$inferSelect;

export const pricingFileEntries = pgTable("pricing_file_entries", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  idRequest: text("id_request").notNull(),
  cliente: text("cliente").notNull(),
  division: text("division").notNull(),
  salesRep: text("sales_rep").notNull(),
  origen: text("origen").notNull(),
  destino: text("destino").notNull(),
  equipo: text("equipo").notNull(),
  carrier: text("carrier").notNull(),
  carrierRep: text("carrier_rep"),
  costo: numeric("costo", { precision: 12, scale: 2 }).notNull(),
  tarifaAprobada: numeric("tarifa_aprobada", { precision: 12, scale: 2 }).notNull(),
  margen: numeric("margen", { precision: 5, scale: 2 }).notNull(),
  fechaAprobacion: timestamp("fecha_aprobacion").defaultNow(),
  aprobadoPor: text("aprobado_por"),
  fechaVigencia: text("fecha_vigencia"),
  active: boolean("active").notNull().default(true),
});

export const insertPricingFileEntrySchema = createInsertSchema(pricingFileEntries).omit({
  id: true,
  fechaAprobacion: true,
});
export type InsertPricingFileEntry = z.infer<typeof insertPricingFileEntrySchema>;
export type PricingFileEntry = typeof pricingFileEntries.$inferSelect;

export const pricingStatuses = [
  "pendiente",
  "por_revisar",
  "cotizando",
  "enviado",
  "cotizacion_enviada",
  "feedback",
  "ganada",
  "perdida",
  "rechazada",
] as const;

export type PricingStatus = (typeof pricingStatuses)[number];

export const pricingRequests = pgTable("pricing_requests", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  cliente: text("cliente").notNull(),
  prospecto: text("prospecto"),
  division: text("division"),
  tipoEquipo: text("tipo_equipo").notNull(),
  accesorios: text("accesorios").array(),
  rutas: text("rutas").notNull(),
  status: text("status").notNull().default("por_revisar"),
  salesRep: text("sales_rep").notNull(),
  peso: text("peso"),
  unidadMedida: text("unidad_medida"),
  producto: text("producto"),
  tiempoCargaDescarga: text("tiempo_carga_descarga"),
  requiereCruce: boolean("requiere_cruce"),
  ciudadCruce: text("ciudad_cruce"),
  esRFQ: boolean("es_rfq"),
  linkDocumento: text("link_documento"),
  certificacion: text("certificacion"),
  notasPricing: text("notas_pricing"),
  notasCargaComercial: text("notas_carga_comercial"),
  ltlAlto: text("ltl_alto"),
  ltlAncho: text("ltl_ancho"),
  ltlLargo: text("ltl_largo"),
  ltlPeso: text("ltl_peso"),
  ltlImagenes: text("ltl_imagenes"),
  feedback: text("feedback"),
  comentarios: text("comentarios"),
  historial: text("historial"),
  carrier: text("carrier"),
  costoAprobado: numeric("costo_aprobado", { precision: 12, scale: 2 }),
  tarifaVenta: numeric("tarifa_venta", { precision: 12, scale: 2 }),
  margen: numeric("margen", { precision: 5, scale: 2 }),
  urgencia: integer("urgencia").default(0),
  fechaEntrega: timestamp("fecha_entrega"),
  fechaEnvio: timestamp("fecha_envio"),
  fechaCierre: timestamp("fecha_cierre"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const insertPricingRequestSchema = createInsertSchema(pricingRequests).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
}).extend({
  // New records must have an explicit classification; historical nulls stay untouched.
  esRFQ: z.boolean().default(false),
});
export type InsertPricingRequest = z.infer<typeof insertPricingRequestSchema>;
export type PricingRequest = typeof pricingRequests.$inferSelect;

export const carrierOffers = pgTable("carrier_offers", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  requestId: varchar("request_id").notNull(),
  carrier: text("carrier").notNull(),
  carrierRep: text("carrier_rep"),
  costo: numeric("costo", { precision: 12, scale: 2 }).notNull(),
  ventaSugerida: numeric("venta_sugerida", { precision: 12, scale: 2 }),
  margen: numeric("margen", { precision: 5, scale: 2 }),
  selected: boolean("selected").notNull().default(false),
  createdAt: timestamp("created_at").defaultNow(),
});

export const insertCarrierOfferSchema = createInsertSchema(carrierOffers).omit({
  id: true,
  createdAt: true,
});
export type InsertCarrierOffer = z.infer<typeof insertCarrierOfferSchema>;
export type CarrierOffer = typeof carrierOffers.$inferSelect;

export const notifications = pgTable("notifications", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull(),
  title: text("title").notNull(),
  message: text("message").notNull(),
  type: text("type").notNull().default("info"),
  requestId: varchar("request_id"),
  read: boolean("read").notNull().default(false),
  createdAt: timestamp("created_at").defaultNow(),
});

// Idempotency claims for external notification dispatches. A stable event key
// prevents browser retries from sending the same Slack/email event twice.
export const notificationDispatches = pgTable("notification_dispatches", {
  eventKey: text("event_key").primaryKey(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertNotificationSchema = createInsertSchema(notifications).omit({
  id: true,
  createdAt: true,
});
export type InsertNotification = z.infer<typeof insertNotificationSchema>;
export type Notification = typeof notifications.$inferSelect;

// --- Copiloto explicador ---
// Precotizaciones calculadas por el orquestador, recuperables por
// quoteId+rutaId desde cualquier proceso y tras reinicios del servidor.
// Comentarios y sugerencias de carriers/pricing sobre el modelo o el copiloto.
export const copilotComments = pgTable(
  "copilot_comments",
  {
    id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
    authorId: text("author_id").notNull(),
    authorName: text("author_name").notNull().default(""),
    authorRole: text("author_role").notNull().default(""),
    comment: text("comment").notNull(),
    quoteId: text("quote_id"),
    rutaId: text("ruta_id"),
    modelKey: text("model_key"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("ix_copilot_comments_created_at").on(table.createdAt)],
);
export type CopilotComment = typeof copilotComments.$inferSelect;

export const copilotQuotes = pgTable(
  "copilot_quotes",
  {
    storeKey: text("store_key").primaryKey(),
    quoteRequest: jsonb("quote_request").notNull(),
    pricingResult: jsonb("pricing_result").notNull(),
    modelosDisponibles: jsonb("modelos_disponibles").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("ix_copilot_quotes_expires_at").on(table.expiresAt)],
);
export type CopilotQuote = typeof copilotQuotes.$inferSelect;

// Contadores de cuota diaria del copiloto (generación y embeddings). La
// escribe el servicio Python del orquestador; se define aquí para que la
// tabla exista en la base compartida y sea visible para Drizzle.
export const copilotUsage = pgTable(
  "copilot_usage",
  {
    reservationId: text("reservation_id").primaryKey(),
    scope: text("scope").notNull().default("generation"),
    usageDay: text("usage_day").notNull(),
    subjectHash: text("subject_hash").notNull(),
    status: text("status").notNull(),
    reservedTokens: integer("reserved_tokens").notNull(),
    inputTokens: integer("input_tokens").notNull().default(0),
    outputTokens: integer("output_tokens").notNull().default(0),
    createdAt: text("created_at").notNull(),
    settledAt: text("settled_at"),
  },
  (table) => [
    index("ix_copilot_usage_scope_day_subject").on(
      table.scope,
      table.usageDay,
      table.subjectHash,
    ),
  ],
);
export type CopilotUsage = typeof copilotUsage.$inferSelect;

// Explicaciones generadas por el copiloto, persistidas para consulta posterior
// sin volver a consumir tokens. Identidad: quoteId + rutaId + modelKey +
// pricingHash (hash del resultado de pricing). Nunca se sobrescriben: un
// cambio de pricing crea una versión nueva y conserva las anteriores.
export const copilotExplanations = pgTable(
  "copilot_explanations",
  {
    id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
    quoteId: text("quote_id").notNull(),
    rutaId: text("ruta_id").notNull(),
    modelKey: text("model_key").notNull(),
    modelLabel: text("model_label").notNull(),
    pricingHash: text("pricing_hash").notNull(),
    origen: text("origen").notNull().default(""),
    destino: text("destino").notNull().default(""),
    costoExplicado: numeric("costo_explicado"),
    moneda: text("moneda").notNull().default("MXN"),
    // Respuesta estructurada completa del copiloto (answer, historical_support,
    // citations, warnings, model, prompt/index versions, usage de tokens).
    respuesta: jsonb("respuesta"),
    errorMensaje: text("error_mensaje"),
    status: text("status").notNull().default("generating"), // generating | completed | failed
    solicitanteId: text("solicitante_id").notNull(),
    solicitanteNombre: text("solicitante_nombre").notNull().default(""),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    completedAt: timestamp("completed_at", { withTimezone: true }),
  },
  (table) => [
    uniqueIndex("ux_copilot_explanations_identity").on(
      table.quoteId,
      table.rutaId,
      table.modelKey,
      table.pricingHash,
    ),
    index("ix_copilot_explanations_created_at").on(table.createdAt),
    index("ix_copilot_explanations_quote").on(table.quoteId),
  ],
);
export type CopilotExplanation = typeof copilotExplanations.$inferSelect;

// Caché compartido de rutas de Google Maps (fuente de verdad en Postgres).
// Declarado aquí para que drizzle-kit push NO intente eliminar la tabla
// (el DDL original vive en server/migrate.ts).
export const googleMapsRouteCache = pgTable("google_maps_route_cache", {
  routeKey: text("route_key").primaryKey(),
  routeLabel: text("route_label").notNull().default(""),
  originAddress: text("origin_address").notNull().default(""),
  destinationAddress: text("destination_address").notNull().default(""),
  googleDistanceM: doublePrecision("google_distance_m").notNull(),
  googleOriginLat: doublePrecision("google_origin_lat"),
  googleOriginLng: doublePrecision("google_origin_lng"),
  googleDestinationLat: doublePrecision("google_destination_lat"),
  googleDestinationLng: doublePrecision("google_destination_lng"),
  googleOriginElevationM: doublePrecision("google_origin_elevation_m"),
  googleDestinationElevationM: doublePrecision("google_destination_elevation_m"),
  apiStatus: text("api_status").notNull().default("OK"),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});
export type GoogleMapsRouteCacheRow = typeof googleMapsRouteCache.$inferSelect;
