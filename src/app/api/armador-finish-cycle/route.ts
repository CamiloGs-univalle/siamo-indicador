import { NextRequest } from "next/server";
import { finishCycle } from "@/backend/controllers/armador-finish-cycle.controller";

export async function POST(request: NextRequest) {
  return finishCycle(request);
}
