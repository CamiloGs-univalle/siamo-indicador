import { NextRequest } from "next/server";
import { createAdmin, listAdmins } from "@/backend/controllers/admins.controller";

export async function POST(request: NextRequest) {
  return createAdmin(request);
}

export async function GET(request: NextRequest) {
  return listAdmins(request);
}
