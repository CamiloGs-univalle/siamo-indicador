import { NextRequest } from "next/server";
import { saveSession, clearSession } from "@/backend/controllers/armador-session.controller";

export async function POST(request: NextRequest) {
  return saveSession(request);
}

export async function PUT(request: NextRequest) {
  return clearSession(request);
}
