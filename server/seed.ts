import { db } from "./db";
import { users, clientes, divisiones, tiposEquipo, accesorios } from "@shared/schema";
import { sql } from "drizzle-orm";

async function seedDatabase() {
  console.log("Starting database seed...");

  try {
    const existingUsers = await db.select().from(users).limit(1);
    if (existingUsers.length > 0) {
      console.log("Database already seeded, skipping...");
      return;
    }

    console.log("Seeding users...");
    const usersData = [
      { username: "admin", password: "$2b$10$59wj64QrGs2HXHt5oEueKuh21SDPfoJdwatE55rvLeUOLobST.jTK", name: "Administrador", email: "admin@vax.com", role: "superadmin" as const },
      { username: "daniel_chavez", password: "$2b$10$HVGneAxP0EtXFRHHKoBIye/c6djPZvVlynJaCApwzw/cdO4rtUKQi", name: "Daniel Chavez", email: "daniel.chavez@vaxsolutions.mx", role: "sales_rep" as const },
      { username: "jessica_hernandez", password: "$2b$10$qThsoe/qrNUmHZ6aCUCHQOze/jHoAsqK8fSirm62CdDTQAYrshd.e", name: "Jessica Hernandez", email: "jessica.hernandez@vaxsolutions.mx", role: "sales_rep" as const },
      { username: "jesus_velazquez", password: "$2b$10$TSROH0QsyWmL5sZ5lBOJRe6/6RZiivdKpeAOM5uaMVlWxi8sf5IzK", name: "Jesus Velazquez", email: "jesus.velazquez@vaxsolutions.mx", role: "sales_rep" as const },
      { username: "juan_macias", password: "$2b$10$A2uBViNG0VijN/i7OZNqT.Jfkn5y1gEwk5GaZ5kP4LPuq51v6pBu6", name: "Juan Macias", email: "juan.macias@vaxsolutions.mx", role: "sales_rep" as const },
      { username: "juan_rojas", password: "$2b$10$1n7kJr9sC2FqZG1hdoOVdedvFbMv.RR9VNC4FUieLeZ1OCD5S7Zn2", name: "Juan Rojas", email: "juan.rojas@vaxsolutions.mx", role: "sales_rep" as const },
      { username: "thalia_orendain", password: "$2b$10$/F6Am9muQGKUGw2RG4W4ium4rlj7pUL410tMP6dQ/9eH4bEm8Ys2e", name: "Thalia Orendain", email: "thalia.orendain@vaxsolutions.mx", role: "sales_rep" as const },
      { username: "luis_ortiz", password: "$2b$10$m.1oY1v2tWE9KQ/qYF/nWu670mdeCpHVhCWdXjrY7fqtx3zDC2RlS", name: "Luis Ortiz", email: "luis.ortiz@vaxsolutions.mx", role: "sales_lead" as const },
      { username: "marco_martinez", password: "$2b$10$SuheLXJQ8yxjHM/mNGRcounsnHaoQZCvhyQ96OYo9daDEhWS16Zuu", name: "Marco Martinez", email: "marco.martinez@vaxsolutions.mx", role: "sales_lead" as const },
      { username: "blanca_rodriguez", password: "$2b$10$k4FqJe2Tn9nMnxMTQPPOaO9LOlWpuBgdfUIVGw63KXG6.aetEmRXO", name: "Blanca Rodriguez", email: "blanca.rodriguez@vaxsolutions.mx", role: "sales_lead" as const },
      { username: "eduardo_chaim", password: "$2b$10$TMz/9CV5OfroXAy1fKp8Ce5ag8ROT.eFjE1.ZuzpCAm9LwCnBVs9y", name: "Eduardo Chaim", email: "eduardo.chaim@vaxsolutions.mx", role: "sales_lead" as const },
      { username: "cinthia_solorio", password: "$2b$10$KCUUqbJDH/uG/ir7QLVDZ.tTjLoayQwpK2YSf6iuvMJtSRX3fuZvS", name: "Cinthia Solorio", email: "cinthia.solorio@vaxsolutions.mx", role: "pricing" as const },
      { username: "eduardo_varela", password: "$2b$10$mvzzGhTJ4fQkMWFtXDxnJupI7RMbqQmuqnWtTsZ.r/zqK1pCWOX8W", name: "Eduardo Varela", email: "eduardo.varela@vaxsolutions.mx", role: "carrier_manager" as const },
      { username: "montserrat_najera", password: "$2b$10$IZbaHEKKdX8ynpRX2.5QvuQgUOHXqqJG8UxNRJBqBnX6KjFKNXE5K", name: "Montse Najera", email: "montserrat.najera@vaxsolutions.mx", role: "carrier_lead" as const },
      { username: "paula_aya", password: "$2b$10$Z81z9pRy3wb.aKf.5iPpFOJZ2YX4FBpP/YirZ3txABVYqsEWw89JG", name: "Paula Aya", email: "paula.aya@vaxsolutions.mx", role: "carrier_lead" as const },
      { username: "andrea_vazquez", password: "$2b$10$GgeYf54KfDQLL2YbP16kIObvuuqcW/phcNmVPq.CktbYovMgaBRT.", name: "Andrea Vazquez", email: "andrea.vazquez@vaxsolutions.mx", role: "carrier_rep" as const },
      { username: "ulises_meneses", password: "$2b$10$RffAXAg3U/fGQumMbW/pO.4DJCdeGNSXiNvbfm98y/B2P2VkS0buK", name: "Ulises Meneses", email: "ulises.meneses@vaxsolutions.mx", role: "carrier_rep" as const },
      { username: "juan_inzunza", password: "$2b$10$poe4hbVorGcGieHos4zUs..09eIrjnOe6j1.Xxc5S.5xKvqChsMyi", name: "Juan Pablo Inzunza", email: "juan.inzunza@vaxsolutions.mx", role: "carrier_rep" as const },
    ];

    for (const userData of usersData) {
      await db.insert(users).values({
        ...userData,
        active: true,
      }).onConflictDoNothing();
    }
    console.log(`Seeded ${usersData.length} users`);

    console.log("Seeding divisiones...");
    const divisionesData = [
      "Crossborder", "National", "Domestic", "Aerial", 
      "Maritime", "Central America", "Port Freight", "LTL"
    ];
    for (const nombre of divisionesData) {
      await db.insert(divisiones).values({ nombre }).onConflictDoNothing();
    }
    console.log(`Seeded ${divisionesData.length} divisiones`);

    console.log("Seeding tipos de equipo...");
    const tiposEquipoData = [
      "1.5", "3.5", "DryVan / Reefer", "DryVan 53", "Flatbed 20", "Flatbed 40",
      "Flatbed 48", "Flatbed 53", "Flatbed Conestoga", "Full Container 20",
      "Full Container 40", "Full Container Reefer 20", "Full Container Reefer 40",
      "Full DryVan", "Full Flatbed 40", "Full Reefer", "Hazmat 53",
      "Jaula de Volteo", "Jaula Granelera", "Lowboy/Double Drop", "LTL",
      "Pipa", "Rabón", "Rabón Abierto", "Reefer 53", "Removable Gooseneck",
      "Single Container Reefer 20", "Single Container 20", "Single Container 40",
      "Single Container Reefer 40", "Single DryVan", "Single Flatbed 40",
      "Single Reefer", "Sprinter Van", "Stepdeck 53", "Stepdeck Conestoga",
      "Straight Truck", "Tolva", "Torton", "Torton Abierto"
    ];
    for (const nombre of tiposEquipoData) {
      await db.insert(tiposEquipo).values({ nombre }).onConflictDoNothing();
    }
    console.log(`Seeded ${tiposEquipoData.length} tipos de equipo`);

    console.log("Seeding accesorios...");
    const accesoriosData = [
      "NA", "Pistas", "Maniobras", "Estadias", "Repartos/Stops",
      "Barras", "Bandas", "Rampa Hidraulica", "Postes o Rieles Logisticos"
    ];
    for (const nombre of accesoriosData) {
      await db.insert(accesorios).values({ nombre }).onConflictDoNothing();
    }
    console.log(`Seeded ${accesoriosData.length} accesorios`);

    console.log("Seeding clientes...");
    const clientesData = [
      "International Furniture", "Zagis", "Adidas", "Direct Pack Baja", "Tajin",
      "Tempel de México", "Home Depot", "AMI Trading", "Goodpack", "Copamex",
      "Klass Time USA", "Veloci Motors", "Industria del Álcali", "Almex", "ProTrans",
      "Horizon Home", "Vitro Envases", "Arkema", "Comercializadora y Aleaciones del Noroeste",
      "Graphic Packaging", "Innovarr", "Atmosphera Verde", "Clase Azul", "Grupo Cimarron",
      "Traxión", "Plami", "Jumbocel", "Nestle México", "Mauser Packaging International",
      "Iron Mountain Mexico", "Toyo Kasei", "ProTrans International", "Milwaukee Tools",
      "GV Carriers", "GST Automotive", "Cristales Inastillables", "Olexo Foods México",
      "SJ Pack", "Ready Solutions", "DIMSA", "Quala", "SEPHNOS", "Tricorbraun",
      "Birdman", "La Moderna", "Naturasol", "Wave Optics", "QUIMIPOL", "ULD",
      "Pridgeon & Clay", "Maquiladora Gráfica", "Menshen", "DL Medica", "FI Manufacturing",
      "Colchones América", "Niagara", "AKG Termotecnologia", "Industrias Metálicas del Envase",
      "Symrise USA", "Symrise", "Tyson Foods", "Envases de Sinaloa", "West Rock",
      "Grupo Arco Iris Plasticos", "PROANSA", "Comercializadora Atradium", "Bruni",
      "Recubrimientos Plasticos", "Global Ends", "Tremain", "Guy Wire Co.", "Sistela",
      "Bolero", "Team Diversified", "Fuego Envasado", "Flash Container", "Wham Picture",
      "Miraclon", "Reusable Transport Packaging", "Wood Mizer", "Lubricantes Fuchs",
      "Fives Cinetic Group", "Taxan", "Empaques Modernos de Guadalajara", "Grupo Perfimexa",
      "ICAPSA", "5S Erosion Solutions", "Bostik Mexicana", "Senoplast", "Samsung SDS",
      "Orox-co", "Direct Pack de México", "DM International", "Hogan Stakes", "Glinsa",
      "BUNGE", "Armasel", "KlassCo", "Bio Pappel", "Goodpack México", "Dream Pack Group",
      "Amcor Rigid Packaging de México", "Paroli", "Cervs Recycling", "Sport Solutions",
      "UWipes", "Dürr Universal", "Grupo CG Maderas", "International Paper",
      "Canmex Dollar Stores", "Coppel", "Marcas Nestle", "CPW México", "Lidercel",
      "Gemtron de México", "DIPISUR", "OWENS AMERICA", "TOYO FOODS BOEKI", "KUMCO",
      "Echo Global Logistics", "GLM Group", "ESJ", "DLX Logistix", "Lumaol USA",
      "Multimatic", "Stephen Gould de México", "Viscofan USA", "Plastic Trends",
      "Distribuidora del Secreto", "Grupo Julio's", "Avery Dennison",
      "PSC S & S Industries de Mexico", "Topura Fastener De México", "FIFCO",
      "HEXPOL Compounding", "RTC", "Palos Garza", "Maflow", "PAS APPLIANCE SYSTEMS",
      "Eco agri tec", "Best Ingredients México", "Grupo Estudiat",
      "OUT MOVEMENT AND LOGISTICS SA DE CV", "International Metals de Mexico",
      "Sante", "Eco Lean", "Bacardi", "Nufer plus", "Mexifrutas", "Bostik XB",
      "Comegsa", "Sky Jack México", "Alimentos Susalia", "Distribuidora PJ", "Bioflex",
      "Estapack", "Crawford packaging", "Operadoras en Servicios Comerciales (Italika)",
      "Comercializadora de Motocicletas de Calidad (Italika)", "Laziali", "Desoflex",
      "Suzuyo", "Lucas Bols", "Schreiber Foods", "Sk Express", "Valvoline",
      "Veladora Mexico", "Phoenix Packaging", "Kiye", "Pasion Por Madera", "Sodimac",
      "BRIMEX Energy", "Italli", "Bekax", "Tupperware", "JMA Llaves Altuna",
      "American Anchor", "B fashionistas", "Propasa", "Precision Resources",
      "IMPORTADORA MINISO", "ADJ Industries USA", "Recologic", "SPRING AIR",
      "SOLAREVER", "Mubit", "Fibras Opticas de México", "SINAX", "Zagis USA",
      "Solarever", "Templa Cristal y aceros", "AGC", "FOMS Colombia", "Indelpro",
      "Tododren", "Valle Redondo", "Irrigaciones y Servicios Industriales",
      "Tapon Corona", "M. Holland Latinoamerica", "Eco Trade",
      "Resinas de Alto Rendimiento", "SEJUM", "POCHTECA MATERIAS PRIMAS",
      "Smart Bamboo", "Operadora Marta", "Gesol", "Truffino", "Bridgeco",
      "Stylos Tech Mexico", "Lpet", "ASMAK TEC", "Corey Solar", "La Universal Impresora",
      "Gustinos", "IVEX MANUFACTURING", "Bicicletas Mercurio", "Corey Energy",
      "BASF MEXICANA", "Plantamex", "Active Leasing", "Direct Pack International",
      "Oleoespecias", "Industria Nacional de Detergentes", "ACH FOODS", "PISA", "EDP",
      "Grupo Comercial TRZ Internacional", "Digrans", "GRUPO INDUSTRIAL ARTES GRAFICAS"
    ];
    for (const nombre of clientesData) {
      await db.insert(clientes).values({ nombre }).onConflictDoNothing();
    }
    console.log(`Seeded ${clientesData.length} clientes`);

    console.log("Database seed completed successfully!");
  } catch (error) {
    console.error("Error seeding database:", error);
    throw error;
  }
}

export { seedDatabase };
