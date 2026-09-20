import { NextRequest } from "next/server";
import { cedulaLogin } from "@/backend/controllers/cedula-login.controller";

export async function POST(request: NextRequest) {
  return cedulaLogin(request);
}
