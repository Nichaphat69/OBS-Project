-- CreateTable
CREATE TABLE "customers" (
    "id" TEXT NOT NULL,
    "name_th" TEXT NOT NULL,
    "name_en" TEXT,
    "tax_id" TEXT NOT NULL,
    "branch" TEXT DEFAULT 'สำนักงานใหญ่',
    "address" TEXT,
    "credit_days" INTEGER NOT NULL DEFAULT 30,
    "billing_place" TEXT,
    "contact_name" TEXT,
    "contact_phone" TEXT,
    "contact_email" TEXT,
    "flowaccount_contact_id" TEXT,
    "created_at" TEXT NOT NULL,
    "email_domain" TEXT,

    CONSTRAINT "customers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "contracts" (
    "id" TEXT NOT NULL,
    "customer_id" TEXT NOT NULL,
    "po_no" TEXT NOT NULL,
    "contract_no" TEXT,
    "project_name" TEXT NOT NULL,
    "po_date" TEXT,
    "start_date" TEXT NOT NULL,
    "end_date" TEXT NOT NULL,
    "credit_days" INTEGER NOT NULL DEFAULT 30,
    "divisor_mode" TEXT NOT NULL DEFAULT 'fixed',
    "divisor_value" INTEGER NOT NULL DEFAULT 20,
    "vat_rate" DOUBLE PRECISION NOT NULL DEFAULT 0.07,
    "wht_rate" DOUBLE PRECISION NOT NULL DEFAULT 0.03,
    "status" TEXT NOT NULL DEFAULT 'active',
    "abbyy_skill_id" TEXT,
    "created_at" TEXT NOT NULL,

    CONSTRAINT "contracts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "employees" (
    "id" TEXT NOT NULL,
    "name_th" TEXT NOT NULL,
    "name_en" TEXT,
    "invoice_position" TEXT NOT NULL,
    "hrdd_employee_code" TEXT,
    "created_at" TEXT NOT NULL,
    "line_user_id" TEXT,
    "line_link_code" TEXT,
    "line_link_code_expires_at" TEXT,
    "line_pending_ticket_category" TEXT,

    CONSTRAINT "employees_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "employee_aliases" (
    "employee_id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "alias" TEXT NOT NULL,
    "source" TEXT,

    CONSTRAINT "employee_aliases_pkey" PRIMARY KEY ("employee_id","kind","alias")
);

-- CreateTable
CREATE TABLE "assignments" (
    "id" TEXT NOT NULL,
    "contract_id" TEXT NOT NULL,
    "employee_id" TEXT NOT NULL,
    "quotation_no" TEXT,
    "monthly_rate" DOUBLE PRECISION NOT NULL,
    "start_date" TEXT NOT NULL,
    "end_date" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'active',

    CONSTRAINT "assignments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "holidays" (
    "id" SERIAL NOT NULL,
    "date" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "customer_id" TEXT,

    CONSTRAINT "holidays_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "timesheets" (
    "id" TEXT NOT NULL,
    "contract_id" TEXT NOT NULL,
    "employee_id" TEXT,
    "period" TEXT NOT NULL,
    "source_email_id" TEXT,
    "source_email_subject" TEXT,
    "source_file" TEXT,
    "source_file_bytes" BYTEA,
    "received_at" TEXT NOT NULL,
    "approved_by" TEXT,
    "approved_at" TEXT,
    "raw_employee_name" TEXT,
    "raw_position" TEXT,
    "reported_workdays" INTEGER,
    "reported_leave" INTEGER,
    "extraction" JSONB,
    "status" TEXT NOT NULL DEFAULT 'received',
    "status_reason" TEXT,
    "computed" JSONB,
    "created_at" TEXT NOT NULL,
    "updated_at" TEXT NOT NULL,
    "submission_method" TEXT,

    CONSTRAINT "timesheets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "gmail_dismissed" (
    "message_id" TEXT NOT NULL,
    "dismissed_by" TEXT,
    "dismissed_at" TEXT NOT NULL,

    CONSTRAINT "gmail_dismissed_pkey" PRIMARY KEY ("message_id")
);

-- CreateTable
CREATE TABLE "support_tickets" (
    "id" SERIAL NOT NULL,
    "employee_id" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'open',
    "created_at" TEXT NOT NULL,
    "resolved_at" TEXT,
    "resolved_by" TEXT,

    CONSTRAINT "support_tickets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_reads" (
    "id" SERIAL NOT NULL,
    "source" TEXT NOT NULL,
    "source_email_id" TEXT,
    "file_name" TEXT,
    "employee_name" TEXT,
    "period" TEXT,
    "document_no" TEXT,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "model" TEXT,
    "extraction" JSONB,
    "file_bytes" BYTEA,
    "read_at" TEXT NOT NULL,
    "read_by" TEXT,

    CONSTRAINT "ai_reads_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "timesheet_days" (
    "timesheet_id" TEXT NOT NULL,
    "date" TEXT NOT NULL,
    "day_of_week" TEXT,
    "project" TEXT,
    "time_in" TEXT,
    "time_out" TEXT,
    "ot_time_in" TEXT,
    "ot_time_out" TEXT,
    "type" TEXT,
    "label" TEXT,
    "job_desc" TEXT,
    "remark" TEXT,
    "normal_hours" DOUBLE PRECISION,
    "ot_hours" DOUBLE PRECISION,
    "total_hours" DOUBLE PRECISION,

    CONSTRAINT "timesheet_days_pkey" PRIMARY KEY ("timesheet_id","date")
);

-- CreateTable
CREATE TABLE "leave_days" (
    "timesheet_id" TEXT NOT NULL,
    "date" TEXT NOT NULL,
    "leave_type" TEXT NOT NULL,

    CONSTRAINT "leave_days_pkey" PRIMARY KEY ("timesheet_id","date")
);

-- CreateTable
CREATE TABLE "overtime_days" (
    "timesheet_id" TEXT NOT NULL,
    "date" TEXT NOT NULL,
    "hours" DOUBLE PRECISION NOT NULL,

    CONSTRAINT "overtime_days_pkey" PRIMARY KEY ("timesheet_id","date")
);

-- CreateTable
CREATE TABLE "invoices" (
    "id" TEXT NOT NULL,
    "contract_id" TEXT NOT NULL,
    "period" TEXT NOT NULL,
    "document_no" TEXT,
    "share_link" TEXT,
    "document_pdf" BYTEA,
    "document_date" TEXT NOT NULL,
    "due_date" TEXT,
    "total" DOUBLE PRECISION NOT NULL,
    "discount_total" DOUBLE PRECISION NOT NULL,
    "total_after_discount" DOUBLE PRECISION NOT NULL,
    "vat" DOUBLE PRECISION NOT NULL,
    "grand_total" DOUBLE PRECISION NOT NULL,
    "withholding_tax" DOUBLE PRECISION NOT NULL,
    "payment_amount" DOUBLE PRECISION NOT NULL,
    "remark" TEXT,
    "payload" TEXT,
    "response" TEXT,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "approved_by" TEXT,
    "approved_at" TEXT,
    "email_draft" TEXT,
    "gmail_draft_id" TEXT,
    "gmail_thread_id" TEXT,
    "email_sent_at" TEXT,
    "email_sent_by" TEXT,
    "created_at" TEXT NOT NULL,

    CONSTRAINT "invoices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "invoice_items" (
    "invoice_id" TEXT NOT NULL,
    "seq" INTEGER NOT NULL,
    "employee_id" TEXT,
    "timesheet_id" TEXT,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "quantity" DOUBLE PRECISION NOT NULL,
    "unit_name" TEXT NOT NULL,
    "price_per_unit" DOUBLE PRECISION NOT NULL,
    "discount" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "amount" DOUBLE PRECISION NOT NULL,

    CONSTRAINT "invoice_items_pkey" PRIMARY KEY ("invoice_id","seq")
);

-- CreateTable
CREATE TABLE "cycle_approvals" (
    "contract_id" TEXT NOT NULL,
    "period" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "requested_at" TEXT NOT NULL,
    "requested_by" TEXT,
    "decided_at" TEXT,
    "decided_by" TEXT,
    "line_message_id" TEXT,

    CONSTRAINT "cycle_approvals_pkey" PRIMARY KEY ("contract_id","period")
);

-- CreateTable
CREATE TABLE "users" (
    "username" TEXT NOT NULL,
    "name_th" TEXT NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'user',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "password_salt" TEXT NOT NULL,
    "password_hash" TEXT NOT NULL,
    "created_at" TEXT NOT NULL,
    "employee_id" TEXT,
    "email" TEXT,
    "self_registered" BOOLEAN NOT NULL DEFAULT false,
    "google_sub" TEXT,
    "reset_code_hash" TEXT,
    "reset_code_salt" TEXT,
    "reset_code_expires_at" TEXT,
    "reset_code_attempts" INTEGER NOT NULL DEFAULT 0,
    "reset_token_hash" TEXT,
    "reset_token_salt" TEXT,
    "reset_token_expires_at" TEXT,

    CONSTRAINT "users_pkey" PRIMARY KEY ("username")
);

-- CreateTable
CREATE TABLE "sessions" (
    "token" TEXT NOT NULL,
    "username" TEXT NOT NULL,
    "created_at" TEXT NOT NULL,
    "expires_at" TEXT NOT NULL,

    CONSTRAINT "sessions_pkey" PRIMARY KEY ("token")
);

-- CreateTable
CREATE TABLE "audit_log" (
    "id" SERIAL NOT NULL,
    "at" TEXT NOT NULL,
    "actor" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "entity_type" TEXT,
    "entity_id" TEXT,
    "detail" TEXT,

    CONSTRAINT "audit_log_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "settings" (
    "key" TEXT NOT NULL,
    "value" TEXT NOT NULL,

    CONSTRAINT "settings_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "abbyy_skills" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "skill_id" TEXT NOT NULL,
    "created_at" TEXT NOT NULL,

    CONSTRAINT "abbyy_skills_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "assignments_contract_id_employee_id_key" ON "assignments"("contract_id", "employee_id");

-- CreateIndex
CREATE UNIQUE INDEX "holidays_date_customer_id_key" ON "holidays"("date", "customer_id");

-- CreateIndex
CREATE INDEX "timesheets_period_status_idx" ON "timesheets"("period", "status");

-- CreateIndex
CREATE INDEX "support_tickets_status_idx" ON "support_tickets"("status");

-- CreateIndex
CREATE INDEX "ai_reads_period_status_idx" ON "ai_reads"("period", "status");

-- CreateIndex
CREATE UNIQUE INDEX "invoices_contract_id_period_key" ON "invoices"("contract_id", "period");

-- CreateIndex
CREATE INDEX "sessions_username_idx" ON "sessions"("username");

-- CreateIndex
CREATE INDEX "audit_log_entity_type_entity_id_idx" ON "audit_log"("entity_type", "entity_id");

-- CreateIndex
CREATE UNIQUE INDEX "abbyy_skills_skill_id_key" ON "abbyy_skills"("skill_id");

-- AddForeignKey
ALTER TABLE "contracts" ADD CONSTRAINT "contracts_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employee_aliases" ADD CONSTRAINT "employee_aliases_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "employees"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assignments" ADD CONSTRAINT "assignments_contract_id_fkey" FOREIGN KEY ("contract_id") REFERENCES "contracts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assignments" ADD CONSTRAINT "assignments_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "holidays" ADD CONSTRAINT "holidays_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "timesheets" ADD CONSTRAINT "timesheets_contract_id_fkey" FOREIGN KEY ("contract_id") REFERENCES "contracts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "timesheets" ADD CONSTRAINT "timesheets_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "employees"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "support_tickets" ADD CONSTRAINT "support_tickets_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "timesheet_days" ADD CONSTRAINT "timesheet_days_timesheet_id_fkey" FOREIGN KEY ("timesheet_id") REFERENCES "timesheets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "leave_days" ADD CONSTRAINT "leave_days_timesheet_id_fkey" FOREIGN KEY ("timesheet_id") REFERENCES "timesheets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "overtime_days" ADD CONSTRAINT "overtime_days_timesheet_id_fkey" FOREIGN KEY ("timesheet_id") REFERENCES "timesheets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_contract_id_fkey" FOREIGN KEY ("contract_id") REFERENCES "contracts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoice_items" ADD CONSTRAINT "invoice_items_invoice_id_fkey" FOREIGN KEY ("invoice_id") REFERENCES "invoices"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoice_items" ADD CONSTRAINT "invoice_items_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "employees"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoice_items" ADD CONSTRAINT "invoice_items_timesheet_id_fkey" FOREIGN KEY ("timesheet_id") REFERENCES "timesheets"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cycle_approvals" ADD CONSTRAINT "cycle_approvals_contract_id_fkey" FOREIGN KEY ("contract_id") REFERENCES "contracts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "employees"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_username_fkey" FOREIGN KEY ("username") REFERENCES "users"("username") ON DELETE CASCADE ON UPDATE CASCADE;
