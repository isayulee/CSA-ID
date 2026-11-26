import { getBindings } from "@/lib/cloudflare";
import { getDb } from "@/lib/db";
import { handleIntake } from "@/lib/intake";

export async function POST(request: Request) {
  return handleIntake(request, { db: getDb(), secret: getBindings().INTAKE_SECRET });
}
