ALTER TABLE "incidents" ADD COLUMN "open_notified_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "incidents" ADD COLUMN "close_notified_at" timestamp with time zone;--> statement-breakpoint
CREATE UNIQUE INDEX "incidents_one_open_per_monitor" ON "incidents" USING btree ("monitor_id") WHERE "incidents"."status" = 'open';