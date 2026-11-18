import "server-only";
import { isAdministrator } from "@/lib/admin";
import { getBindings } from "@/lib/cloudflare";
import { getCurrentAccount } from "./current-user";

/** The signed-in account when its User is on the ADMIN_GOOGLE_SUBS allowlist, otherwise null. */
export async function getCurrentAdministrator() {
  const account = await getCurrentAccount();
  return account && isAdministrator(account.user, getBindings().ADMIN_GOOGLE_SUBS) ? account : null;
}
