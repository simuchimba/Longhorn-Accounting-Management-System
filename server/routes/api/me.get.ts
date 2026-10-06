import { defineHandler } from "nitro";
import { isSupabaseConfigured, requireCaller } from "../../utils/supabase";

/**
 * Who am I, and what am I allowed to do?
 *
 * The frontend calls this right after sign-in so the sidebar, the voucher
 * composer and the admin panel all agree on role and company. Role and company
 * are resolved on the server from the `profiles` row, never from anything the
 * browser sends.
 */
export default defineHandler(async (event) => {
  if (!isSupabaseConfigured()) {
    // Not the same problem as a missing migration, and must not be reported as one.
    // needsMigration stays false so the UI tells the truth: the server has no
    // database credentials, which is fixed in Vercel, not in the SQL editor.
    return {
      user: null,
      needsMigration: false,
      setupRequired: true,
    };
  }

  const caller = await requireCaller(event);
  return {
    user: {
      id: caller.id,
      email: caller.email,
      fullName: caller.fullName,
      role: caller.role,
      companyId: caller.companyId,
      company: caller.company,
      isAdmin: caller.isAdmin,
      isApprover: caller.isApprover,
      canPrepare: caller.canPrepare,
    },
    needsMigration: caller.needsMigration,
    setupRequired: false,
  };
});