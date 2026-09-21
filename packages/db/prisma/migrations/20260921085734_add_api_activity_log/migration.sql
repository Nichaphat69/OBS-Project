-- CreateTable
CREATE TABLE "api_activity_log" (
    "id" SERIAL NOT NULL,
    "at" TEXT NOT NULL,
    "direction" TEXT NOT NULL,
    "service" TEXT NOT NULL,
    "method" TEXT NOT NULL,
    "path" TEXT NOT NULL,
    "duration_ms" INTEGER NOT NULL,
    "status_code" INTEGER,
    "ok" BOOLEAN NOT NULL,
    "request_body" TEXT,
    "response_body" TEXT,
    "error_message" TEXT,

    CONSTRAINT "api_activity_log_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "api_activity_log_at_idx" ON "api_activity_log"("at");

-- CreateIndex
CREATE INDEX "api_activity_log_direction_service_idx" ON "api_activity_log"("direction", "service");
