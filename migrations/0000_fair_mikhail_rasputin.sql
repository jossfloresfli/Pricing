CREATE TABLE "accesorios" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"nombre" text NOT NULL,
	"descripcion" text,
	"active" boolean DEFAULT true NOT NULL
);
--> statement-breakpoint
CREATE TABLE "carrier_offers" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"request_id" varchar NOT NULL,
	"carrier" text NOT NULL,
	"carrier_rep" text,
	"costo" numeric(12, 2) NOT NULL,
	"venta_sugerida" numeric(12, 2),
	"margen" numeric(5, 2),
	"selected" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "clientes" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"nombre" text NOT NULL,
	"rfc" text,
	"active" boolean DEFAULT true NOT NULL
);
--> statement-breakpoint
CREATE TABLE "divisiones" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"nombre" text NOT NULL,
	"active" boolean DEFAULT true NOT NULL
);
--> statement-breakpoint
CREATE TABLE "pricing_file_entries" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"id_request" text NOT NULL,
	"cliente" text NOT NULL,
	"division" text NOT NULL,
	"sales_rep" text NOT NULL,
	"origen" text NOT NULL,
	"destino" text NOT NULL,
	"equipo" text NOT NULL,
	"carrier" text NOT NULL,
	"carrier_rep" text,
	"costo" numeric(12, 2) NOT NULL,
	"tarifa_aprobada" numeric(12, 2) NOT NULL,
	"margen" numeric(5, 2) NOT NULL,
	"fecha_aprobacion" timestamp DEFAULT now(),
	"aprobado_por" text,
	"fecha_vigencia" text,
	"active" boolean DEFAULT true NOT NULL
);
--> statement-breakpoint
CREATE TABLE "pricing_requests" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"cliente" text NOT NULL,
	"prospecto" text,
	"division" text,
	"tipo_equipo" text NOT NULL,
	"accesorios" text[],
	"rutas" text NOT NULL,
	"status" text DEFAULT 'por_revisar' NOT NULL,
	"sales_rep" text NOT NULL,
	"notas_carga_comercial" text,
	"feedback" text,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "prospectos" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"nombre" text NOT NULL,
	"empresa" text,
	"active" boolean DEFAULT true NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sales_reps" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"nombre" text NOT NULL,
	"email" text,
	"active" boolean DEFAULT true NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tipos_equipo" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"nombre" text NOT NULL,
	"descripcion" text,
	"active" boolean DEFAULT true NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"username" text NOT NULL,
	"password" text NOT NULL,
	"name" text NOT NULL,
	"email" text,
	"role" text DEFAULT 'sales_rep' NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now(),
	CONSTRAINT "users_username_unique" UNIQUE("username")
);
