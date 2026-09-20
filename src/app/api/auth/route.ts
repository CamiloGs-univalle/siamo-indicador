import { NextRequest } from "next/server";
import { setAuthCookie, clearAuthCookie } from "@/backend/controllers/auth.controller";

export async function POST(request: NextRequest) {
  return setAuthCookie(request);
}

export async function DELETE() {
  return clearAuthCookie();
}
