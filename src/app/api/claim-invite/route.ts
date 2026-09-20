import { NextRequest } from "next/server";
import { claimInvite } from "@/backend/controllers/claim-invite.controller";

export async function POST(request: NextRequest) {
  return claimInvite(request);
}
