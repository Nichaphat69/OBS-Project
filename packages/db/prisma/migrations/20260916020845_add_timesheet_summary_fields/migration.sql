-- AlterTable
ALTER TABLE "timesheets" ADD COLUMN     "summary_total_hours" DOUBLE PRECISION,
ADD COLUMN     "summary_total_leave_days" DOUBLE PRECISION,
ADD COLUMN     "summary_total_work_days" DOUBLE PRECISION;
