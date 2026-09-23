CREATE TYPE "public"."document_source" AS ENUM('upload', 'email', 'batch');--> statement-breakpoint
CREATE TYPE "public"."document_status" AS ENUM('received', 'processing', 'valid', 'needs_review', 'rejected');--> statement-breakpoint
CREATE TABLE "documents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"sha256" text NOT NULL,
	"source" "document_source" NOT NULL,
	"status" "document_status" DEFAULT 'received' NOT NULL,
	"filename" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "documents_sha256_unique" UNIQUE("sha256")
);
