import { defineHandler } from "nitro";
import { createError, readBody } from "nitro/h3";
import { getServiceClient, requireAdmin } from "../../../utils/supabase";

type CreateCompanyBody = {
  name?: string;
  code?: string;
  description?: string;
  color?: string;
};

const HEX = /^#[0-9a-f]{6}$/i;

/** Adds a branch, for example when a fourth Longhorn company joins the ledger. */
export default defineHandler(async (event) => {
  await requireAdmin(event);
  const body = (await readBody<CreateCompanyBody>(event)) || {};

  const name = String(body.name || "").trim();
  const code = String(body.code || "").trim().toUpperCase();
  const description = String(body.description || "").trim() || null;
  const color = String(body.color || "").trim() || "#d71939";

  if (name.length < 3) {
    throw createError({ statusCode: 400, statusMessage: "Give the branch a name of at least 3 characters." });
  }
  if (!/^[A-Z0-9]{2,5}$/.test(code)) {
    throw createError({ statusCode: 400, statusMessage: "Use a short code of 2 to 5 letters or numbers, e.g. LIB." });
  }
  if (!HEX.test(color)) {
    throw createError({ statusCode: 400, statusMessage: "Pick a colour like #d71939." });
  }

  const service = getServiceClient();
  const clash = await service.from("companies").select("id").or(`name.eq.${name},code.eq.${code}`).maybeSingle();
  if (clash.error) throw new Error(clash.error.message);
  if (clash.data) {
    throw createError({ statusCode: 409, statusMessage: "A branch with that name or code already exists." });
  }

  const created = await service
    .from("companies")
    .insert({ name, code, description, color })
    .select("id, name, code, description, color, is_active")
    .single();

  if (created.error) throw createError({ statusCode: 400, statusMessage: created.error.message });

  const row = created.data as Record<string, unknown>;
  return {
    company: {
      id: String(row.id),
      name: String(row.name),
      code: String(row.code),
      description: (row.description as string | null) ?? null,
      color: String(row.color),
      isActive: row.is_active !== false,
    },
  };
});