-- CreateTable
CREATE TABLE "timesheet_submissions" (
    "id" TEXT NOT NULL,
    "employee_id" TEXT NOT NULL,
    "period" TEXT NOT NULL,
    "contract_id" TEXT,
    "method" TEXT,
    "method_chosen_at" TEXT,
    "deferred_at" TEXT,
    "line_user_id" TEXT,
    "acted_by" TEXT,
    "reply_ok" BOOLEAN,
    "reply_failure_reason" TEXT,
    "review_status" TEXT,
    "reviewed_by" TEXT,
    "reviewed_at" TEXT,
    "note" TEXT,
    "created_at" TEXT NOT NULL,
    "updated_at" TEXT NOT NULL,

    CONSTRAINT "timesheet_submissions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "timesheet_submissions_period_idx" ON "timesheet_submissions"("period");

-- CreateIndex
CREATE UNIQUE INDEX "timesheet_submissions_employee_id_period_key" ON "timesheet_submissions"("employee_id", "period");

-- AddForeignKey
ALTER TABLE "timesheet_submissions" ADD CONSTRAINT "timesheet_submissions_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
