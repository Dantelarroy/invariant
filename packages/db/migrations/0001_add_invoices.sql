CREATE TABLE "invoice_lines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"invoice_id" uuid NOT NULL,
	"position" integer NOT NULL,
	"description" text NOT NULL,
	"quantity" numeric(14, 4) NOT NULL,
	"unit_price_cents" bigint NOT NULL,
	"line_total_cents" bigint NOT NULL,
	"vat_rate_bps" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE "invoices" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"document_id" uuid NOT NULL,
	"number" text NOT NULL,
	"issue_date" date NOT NULL,
	"currency" text NOT NULL,
	"supplier_name" text NOT NULL,
	"supplier_tax_id" text,
	"customer_name" text NOT NULL,
	"customer_tax_id" text,
	"tax_base_cents" bigint NOT NULL,
	"vat_amount_cents" bigint NOT NULL,
	"withholding_cents" bigint,
	"total_cents" bigint NOT NULL,
	"prompt_version" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "invoices_document_id_unique" UNIQUE("document_id")
);
--> statement-breakpoint
ALTER TABLE "invoice_lines" ADD CONSTRAINT "invoice_lines_invoice_id_invoices_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."invoices"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE cascade ON UPDATE no action;