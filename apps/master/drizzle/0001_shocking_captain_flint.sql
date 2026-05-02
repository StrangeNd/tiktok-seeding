CREATE TABLE IF NOT EXISTS "accounts" (
	"id" serial PRIMARY KEY NOT NULL,
	"username" text NOT NULL,
	"email" text,
	"status" text DEFAULT 'active' NOT NULL,
	"secret_blob" text,
	"has_password" integer DEFAULT 0 NOT NULL,
	"has_email_password" integer DEFAULT 0 NOT NULL,
	"has_mail_refresh_token" integer DEFAULT 0 NOT NULL,
	"has_mail_client_id" integer DEFAULT 0 NOT NULL,
	"has_cookie" integer DEFAULT 0 NOT NULL,
	"cookie_status" text DEFAULT 'unknown' NOT NULL,
	"last_mail_code_status" text,
	"last_mail_code_error" text,
	"last_mail_code_checked_at" timestamp with time zone,
	"last_error" text,
	"last_checked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "proxies" (
	"id" serial PRIMARY KEY NOT NULL,
	"protocol" text DEFAULT 'http' NOT NULL,
	"host" text NOT NULL,
	"port" integer NOT NULL,
	"username" text,
	"secret_blob" text,
	"has_auth" integer DEFAULT 0 NOT NULL,
	"status" text DEFAULT 'unknown' NOT NULL,
	"latency_ms" integer,
	"last_error" text,
	"last_checked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "accounts_username_idx" ON "accounts" USING btree ("username");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "accounts_email_idx" ON "accounts" USING btree ("email");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "accounts_status_idx" ON "accounts" USING btree ("status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "accounts_cookie_status_idx" ON "accounts" USING btree ("cookie_status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "proxies_host_port_idx" ON "proxies" USING btree ("host","port");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "proxies_status_idx" ON "proxies" USING btree ("status");