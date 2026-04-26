CREATE TABLE IF NOT EXISTS "jobs" (
	"id" serial PRIMARY KEY NOT NULL,
	"order_id" integer NOT NULL,
	"profile_id" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"attempt" integer DEFAULT 0 NOT NULL,
	"error_code" text,
	"error_message" text,
	"duration_ms" integer,
	"worker_name" text,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "orders" (
	"id" serial PRIMARY KEY NOT NULL,
	"type" text NOT NULL,
	"target_url" text NOT NULL,
	"count" integer NOT NULL,
	"watch_seconds" integer NOT NULL,
	"spread_seconds" integer DEFAULT 0 NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"completed_jobs" integer DEFAULT 0 NOT NULL,
	"failed_jobs" integer DEFAULT 0 NOT NULL,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "profiles" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"browser_type" text,
	"browser_version" text,
	"group_id" text,
	"raw_proxy" text,
	"status" text DEFAULT 'available' NOT NULL,
	"last_used_at" timestamp with time zone,
	"synced_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "workers" (
	"name" text PRIMARY KEY NOT NULL,
	"capacity" integer DEFAULT 0 NOT NULL,
	"current_load" integer DEFAULT 0 NOT NULL,
	"version" text,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "jobs" ADD CONSTRAINT "jobs_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "jobs" ADD CONSTRAINT "jobs_profile_id_profiles_id_fk" FOREIGN KEY ("profile_id") REFERENCES "public"."profiles"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "jobs_order_idx" ON "jobs" USING btree ("order_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "jobs_status_idx" ON "jobs" USING btree ("status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "jobs_profile_idx" ON "jobs" USING btree ("profile_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "profiles_status_idx" ON "profiles" USING btree ("status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "profiles_last_used_idx" ON "profiles" USING btree ("last_used_at");