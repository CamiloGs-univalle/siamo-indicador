import { getDebugInfo } from "@/backend/controllers/debug-admin.controller";

export const dynamic = "force-dynamic";

export async function GET() {
  return getDebugInfo();
}
