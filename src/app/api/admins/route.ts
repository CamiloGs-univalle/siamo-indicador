import { NextRequest } from "next/server";
import { createAdmin, listAdmins, updateAdmin, deleteAdmin } from "@/backend/controllers/admins.controller";

export async function POST(request: NextRequest) {
  return createAdmin(request);
}

export async function GET(request: NextRequest) {
  return listAdmins(request);
}

export async function PUT(request: NextRequest) {
  return updateAdmin(request);
}

export async function DELETE(request: NextRequest) {
  return deleteAdmin(request);
}
