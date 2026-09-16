CREATE TYPE "public"."dns_record_type" AS ENUM('A', 'AAAA', 'MX', 'TXT', 'NS', 'CNAME');--> statement-breakpoint
ALTER TYPE "public"."monitor_type" ADD VALUE 'dns';--> statement-breakpoint
CREATE TABLE "dns_changes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"monitor_id" uuid NOT NULL,
	"record_type" "dns_record_type" NOT NULL,
	"old_values" text,
	"new_values" text NOT NULL,
	"detected_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "dns_snapshots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"monitor_id" uuid NOT NULL,
	"record_type" "dns_record_type" NOT NULL,
	"values" text NOT NULL,
	"checked_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "dns_changes" ADD CONSTRAINT "dns_changes_monitor_id_monitors_id_fk" FOREIGN KEY ("monitor_id") REFERENCES "public"."monitors"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dns_snapshots" ADD CONSTRAINT "dns_snapshots_monitor_id_monitors_id_fk" FOREIGN KEY ("monitor_id") REFERENCES "public"."monitors"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "dns_changes_monitor_detected_idx" ON "dns_changes" USING btree ("monitor_id","detected_at");--> statement-breakpoint
CREATE INDEX "dns_snapshots_monitor_record_checked_idx" ON "dns_snapshots" USING btree ("monitor_id","record_type","checked_at");