import { db } from "./db";
import { eq, inArray, and, count } from "drizzle-orm";
import {
  users,
  clientes,
  prospectos,
  salesReps,
  divisiones,
  tiposEquipo,
  accesorios,
  pricingFileEntries,
  pricingRequests,
  carrierOffers,
  notifications,
  notificationDispatches,
  type User,
  type InsertUser,
  type Cliente,
  type InsertCliente,
  type Prospecto,
  type InsertProspecto,
  type SalesRep,
  type InsertSalesRep,
  type Division,
  type InsertDivision,
  type TipoEquipo,
  type InsertTipoEquipo,
  type Accesorio,
  type InsertAccesorio,
  type PricingFileEntry,
  type InsertPricingFileEntry,
  type PricingRequest,
  type InsertPricingRequest,
  type CarrierOffer,
  type InsertCarrierOffer,
  type Notification,
  type InsertNotification,
} from "@shared/schema";

export interface IStorage {
  // Users
  getUser(id: string): Promise<User | undefined>;
  getUserByUsername(username: string): Promise<User | undefined>;
  getUserByEmail(email: string): Promise<User | undefined>;
  getUserBySalesRep(salesRepName: string): Promise<User | undefined>;
  createUser(user: InsertUser): Promise<User>;
  getUsers(): Promise<User[]>;
  updateUser(id: string, user: Partial<InsertUser>): Promise<User | undefined>;
  deleteUser(id: string): Promise<void>;

  // Clientes
  getClientes(): Promise<Cliente[]>;
  createCliente(cliente: InsertCliente): Promise<Cliente>;
  updateCliente(id: string, cliente: Partial<InsertCliente>): Promise<Cliente | undefined>;
  deleteCliente(id: string): Promise<void>;

  // Prospectos
  getProspectos(): Promise<Prospecto[]>;
  createProspecto(prospecto: InsertProspecto): Promise<Prospecto>;
  updateProspecto(id: string, prospecto: Partial<InsertProspecto>): Promise<Prospecto | undefined>;
  deleteProspecto(id: string): Promise<void>;

  // Sales Reps
  getSalesReps(): Promise<SalesRep[]>;
  createSalesRep(salesRep: InsertSalesRep): Promise<SalesRep>;
  updateSalesRep(id: string, salesRep: Partial<InsertSalesRep>): Promise<SalesRep | undefined>;
  deleteSalesRep(id: string): Promise<void>;

  // Divisiones
  getDivisiones(): Promise<Division[]>;
  createDivision(division: InsertDivision): Promise<Division>;
  updateDivision(id: string, division: Partial<InsertDivision>): Promise<Division | undefined>;
  deleteDivision(id: string): Promise<void>;

  // Tipos de Equipo
  getTiposEquipo(): Promise<TipoEquipo[]>;
  createTipoEquipo(tipo: InsertTipoEquipo): Promise<TipoEquipo>;
  updateTipoEquipo(id: string, tipo: Partial<InsertTipoEquipo>): Promise<TipoEquipo | undefined>;
  deleteTipoEquipo(id: string): Promise<void>;

  // Accesorios
  getAccesorios(): Promise<Accesorio[]>;
  createAccesorio(accesorio: InsertAccesorio): Promise<Accesorio>;
  updateAccesorio(id: string, accesorio: Partial<InsertAccesorio>): Promise<Accesorio | undefined>;
  deleteAccesorio(id: string): Promise<void>;

  // Pricing File Entries
  getPricingFileEntries(): Promise<PricingFileEntry[]>;
  createPricingFileEntry(entry: InsertPricingFileEntry): Promise<PricingFileEntry>;
  createPricingFileEntries(entries: InsertPricingFileEntry[]): Promise<PricingFileEntry[]>;

  // Pricing Requests
  getPricingRequests(): Promise<PricingRequest[]>;
  getPricingRequest(id: string): Promise<PricingRequest | undefined>;
  createPricingRequest(request: InsertPricingRequest): Promise<PricingRequest>;
  updatePricingRequest(id: string, data: Partial<InsertPricingRequest>): Promise<PricingRequest | undefined>;
  deletePricingRequest(id: string): Promise<void>;

  // Carrier Offers
  getCarrierOffersByRequest(requestId: string): Promise<CarrierOffer[]>;
  createCarrierOffer(offer: InsertCarrierOffer): Promise<CarrierOffer>;

  // Notifications
  getNotificationsByUser(userId: string): Promise<Notification[]>;
  getUnreadNotificationCount(userId: string): Promise<number>;
  createNotification(
    notification: InsertNotification,
    options?: { sendEmail?: boolean },
  ): Promise<Notification>;
  claimNotificationDispatch(eventKey: string): Promise<boolean>;
  markNotificationAsRead(id: string): Promise<void>;
  markAllNotificationsAsRead(userId: string): Promise<void>;
}

export class DatabaseStorage implements IStorage {
  // Users
  async getUser(id: string): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.id, id));
    return user;
  }

  async getUserByUsername(username: string): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.username, username));
    return user;
  }

  async getUserByEmail(email: string): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.email, email));
    return user;
  }

  async getUserBySalesRep(salesRepName: string): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.name, salesRepName));
    return user;
  }

  async createUser(insertUser: InsertUser): Promise<User> {
    const [user] = await db.insert(users).values(insertUser).returning();
    return user;
  }

  async getUsers(): Promise<User[]> {
    return db.select().from(users);
  }

  async getSalesUsers(): Promise<User[]> {
    return db.select().from(users).where(
      and(
        inArray(users.role, ["sales_rep", "sales_lead", "sales_manager"]),
        eq(users.active, true)
      )
    );
  }

  async updateUser(id: string, data: Partial<InsertUser>): Promise<User | undefined> {
    const [user] = await db.update(users).set(data).where(eq(users.id, id)).returning();
    return user;
  }

  async deleteUser(id: string): Promise<void> {
    await db.delete(users).where(eq(users.id, id));
  }

  // Clientes
  async getClientes(): Promise<Cliente[]> {
    return db.select().from(clientes).where(eq(clientes.active, true));
  }

  async createCliente(cliente: InsertCliente): Promise<Cliente> {
    const [result] = await db.insert(clientes).values(cliente).returning();
    return result;
  }

  async updateCliente(id: string, data: Partial<InsertCliente>): Promise<Cliente | undefined> {
    const [result] = await db.update(clientes).set(data).where(eq(clientes.id, id)).returning();
    return result;
  }

  async deleteCliente(id: string): Promise<void> {
    await db.update(clientes).set({ active: false }).where(eq(clientes.id, id));
  }

  // Prospectos
  async getProspectos(): Promise<Prospecto[]> {
    return db.select().from(prospectos).where(eq(prospectos.active, true));
  }

  async createProspecto(prospecto: InsertProspecto): Promise<Prospecto> {
    const [result] = await db.insert(prospectos).values(prospecto).returning();
    return result;
  }

  async updateProspecto(id: string, data: Partial<InsertProspecto>): Promise<Prospecto | undefined> {
    const [result] = await db.update(prospectos).set(data).where(eq(prospectos.id, id)).returning();
    return result;
  }

  async deleteProspecto(id: string): Promise<void> {
    await db.update(prospectos).set({ active: false }).where(eq(prospectos.id, id));
  }

  // Sales Reps
  async getSalesReps(): Promise<SalesRep[]> {
    return db.select().from(salesReps).where(eq(salesReps.active, true));
  }

  async createSalesRep(salesRep: InsertSalesRep): Promise<SalesRep> {
    const [result] = await db.insert(salesReps).values(salesRep).returning();
    return result;
  }

  async updateSalesRep(id: string, data: Partial<InsertSalesRep>): Promise<SalesRep | undefined> {
    const [result] = await db.update(salesReps).set(data).where(eq(salesReps.id, id)).returning();
    return result;
  }

  async deleteSalesRep(id: string): Promise<void> {
    await db.update(salesReps).set({ active: false }).where(eq(salesReps.id, id));
  }

  // Divisiones
  async getDivisiones(): Promise<Division[]> {
    return db.select().from(divisiones).where(eq(divisiones.active, true));
  }

  async createDivision(division: InsertDivision): Promise<Division> {
    const [result] = await db.insert(divisiones).values(division).returning();
    return result;
  }

  async updateDivision(id: string, data: Partial<InsertDivision>): Promise<Division | undefined> {
    const [result] = await db.update(divisiones).set(data).where(eq(divisiones.id, id)).returning();
    return result;
  }

  async deleteDivision(id: string): Promise<void> {
    await db.update(divisiones).set({ active: false }).where(eq(divisiones.id, id));
  }

  // Tipos de Equipo
  async getTiposEquipo(): Promise<TipoEquipo[]> {
    return db.select().from(tiposEquipo).where(eq(tiposEquipo.active, true));
  }

  async createTipoEquipo(tipo: InsertTipoEquipo): Promise<TipoEquipo> {
    const [result] = await db.insert(tiposEquipo).values(tipo).returning();
    return result;
  }

  async updateTipoEquipo(id: string, data: Partial<InsertTipoEquipo>): Promise<TipoEquipo | undefined> {
    const [result] = await db.update(tiposEquipo).set(data).where(eq(tiposEquipo.id, id)).returning();
    return result;
  }

  async deleteTipoEquipo(id: string): Promise<void> {
    await db.update(tiposEquipo).set({ active: false }).where(eq(tiposEquipo.id, id));
  }

  // Accesorios
  async getAccesorios(): Promise<Accesorio[]> {
    return db.select().from(accesorios).where(eq(accesorios.active, true));
  }

  async createAccesorio(accesorio: InsertAccesorio): Promise<Accesorio> {
    const [result] = await db.insert(accesorios).values(accesorio).returning();
    return result;
  }

  async updateAccesorio(id: string, data: Partial<InsertAccesorio>): Promise<Accesorio | undefined> {
    const [result] = await db.update(accesorios).set(data).where(eq(accesorios.id, id)).returning();
    return result;
  }

  async deleteAccesorio(id: string): Promise<void> {
    await db.update(accesorios).set({ active: false }).where(eq(accesorios.id, id));
  }

  // Pricing File Entries
  async getPricingFileEntries(): Promise<PricingFileEntry[]> {
    return db.select().from(pricingFileEntries).where(eq(pricingFileEntries.active, true));
  }

  async createPricingFileEntry(entry: InsertPricingFileEntry): Promise<PricingFileEntry> {
    const [result] = await db.insert(pricingFileEntries).values(entry).returning();
    return result;
  }

  async createPricingFileEntries(entries: InsertPricingFileEntry[]): Promise<PricingFileEntry[]> {
    if (entries.length === 0) return [];
    const results = await db.insert(pricingFileEntries).values(entries).returning();
    return results;
  }

  // Pricing Requests
  async getPricingRequests(): Promise<PricingRequest[]> {
    return db.select().from(pricingRequests);
  }

  async getPricingRequest(id: string): Promise<PricingRequest | undefined> {
    const [result] = await db.select().from(pricingRequests).where(eq(pricingRequests.id, id));
    return result;
  }

  async createPricingRequest(request: InsertPricingRequest): Promise<PricingRequest> {
    const [result] = await db.insert(pricingRequests).values(request).returning();
    return result;
  }

  async updatePricingRequest(id: string, data: Partial<InsertPricingRequest>): Promise<PricingRequest | undefined> {
    const processedData: Record<string, unknown> = { ...data };
    
    // Convert fechaEnvio string to Date if present
    if (processedData.fechaEnvio && typeof processedData.fechaEnvio === 'string') {
      processedData.fechaEnvio = new Date(processedData.fechaEnvio);
    }
    
    // Convert fechaCierre string to Date if present
    if (processedData.fechaCierre && typeof processedData.fechaCierre === 'string') {
      processedData.fechaCierre = new Date(processedData.fechaCierre);
    }
    
    // Convert fechaEntrega string to Date if present, handle null for clearing
    if (processedData.fechaEntrega === null) {
      processedData.fechaEntrega = null;
    } else if (processedData.fechaEntrega && typeof processedData.fechaEntrega === 'string') {
      processedData.fechaEntrega = new Date(processedData.fechaEntrega);
    }
    
    const [result] = await db.update(pricingRequests).set({ ...processedData, updatedAt: new Date() }).where(eq(pricingRequests.id, id)).returning();
    return result;
  }

  async deletePricingRequest(id: string): Promise<void> {
    await db.transaction(async (tx) => {
      // Delete related records first to avoid foreign key constraints.
      await tx.delete(carrierOffers).where(eq(carrierOffers.requestId, id));
      await tx.delete(notifications).where(eq(notifications.requestId, id));
      await tx.delete(pricingRequests).where(eq(pricingRequests.id, id));
    });
  }

  // Carrier Offers
  async getAllCarrierOffers(): Promise<CarrierOffer[]> {
    return db.select().from(carrierOffers);
  }

  async getCarrierOffersByRequest(requestId: string): Promise<CarrierOffer[]> {
    return db.select().from(carrierOffers).where(eq(carrierOffers.requestId, requestId));
  }

  async createCarrierOffer(offer: InsertCarrierOffer): Promise<CarrierOffer> {
    const [result] = await db.insert(carrierOffers).values(offer).returning();
    return result;
  }

  // Notifications
  async getNotificationsByUser(userId: string): Promise<Notification[]> {
    return db.select().from(notifications).where(eq(notifications.userId, userId));
  }

  async getUnreadNotificationCount(userId: string): Promise<number> {
    const [result] = await db.select({ total: count() }).from(notifications)
      .where(and(eq(notifications.userId, userId), eq(notifications.read, false)));
    return result.total;
  }

  async createNotification(
    notification: InsertNotification,
    options: { sendEmail?: boolean } = {},
  ): Promise<Notification> {
    const [result] = await db.insert(notifications).values(notification).returning();
    
    // Send email notification
    if (options.sendEmail !== false) {
      try {
        const user = await this.getUser(notification.userId);
        if (user && user.email) {
          const { sendNotificationEmail } = await import('./emailService');
          await sendNotificationEmail({
            to: user.email,
            userName: user.name || user.username || 'Usuario',
            title: notification.title,
            message: notification.message,
            type: notification.type || 'info',
            requestId: notification.requestId || undefined,
          });
        }
      } catch (error) {
        console.error('Failed to send email notification:', error);
      }
    }
    
    return result;
  }

  async claimNotificationDispatch(eventKey: string): Promise<boolean> {
    const claimed = await db
      .insert(notificationDispatches)
      .values({ eventKey })
      .onConflictDoNothing()
      .returning({ eventKey: notificationDispatches.eventKey });
    return claimed.length === 1;
  }

  async markNotificationAsRead(id: string): Promise<void> {
    await db.update(notifications).set({ read: true }).where(eq(notifications.id, id));
  }

  async markAllNotificationsAsRead(userId: string): Promise<void> {
    await db.update(notifications).set({ read: true }).where(eq(notifications.userId, userId));
  }
}

export const storage = new DatabaseStorage();
