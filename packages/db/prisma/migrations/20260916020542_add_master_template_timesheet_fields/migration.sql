-- AlterTable
ALTER TABLE "timesheet_days" ADD COLUMN     "activity" TEXT,
ADD COLUMN     "additional_hours" DOUBLE PRECISION,
ADD COLUMN     "break_hours" DOUBLE PRECISION,
ADD COLUMN     "leave_days" DOUBLE PRECISION,
ADD COLUMN     "leave_type" TEXT,
ADD COLUMN     "ot_break_hours" DOUBLE PRECISION,
ADD COLUMN     "row_number" TEXT,
ADD COLUMN     "site" TEXT,
ADD COLUMN     "work_location" TEXT;

-- AlterTable
ALTER TABLE "timesheets" ADD COLUMN     "approver_name" TEXT,
ADD COLUMN     "client_name" TEXT,
ADD COLUMN     "department" TEXT,
ADD COLUMN     "month_year" TEXT,
ADD COLUMN     "project_name" TEXT,
ADD COLUMN     "project_team" TEXT,
ADD COLUMN     "raw_employee_id" TEXT,
ADD COLUMN     "reporting_period" TEXT,
ADD COLUMN     "role" TEXT,
ADD COLUMN     "site" TEXT,
ADD COLUMN     "supervisor_name" TEXT,
ADD COLUMN     "vendor_name" TEXT;
