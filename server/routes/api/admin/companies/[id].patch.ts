import { defineHandler } from "nitro";
import { createError, getRouterParam, readBody } from "nitro/h3";
import { getServiceClient, requireAdmin } from "../../../../utils/supabase";

type UpdateCompanyBody = {
  name?: string;
  description?: string | null;
  color?: string;
  isActive?: boolean;
};

const HEX = /^#[0-9a-f]{6}$/i;

/** Renames a branch, recolours it, or stands it down. The code is fixed once set. */
export default defineHandler(async (event) => {
  await requireAdmin(event);

  const id = String(getRouterParam(event, "id") || "").trim();
  if (!id) throw createError({ statusCode: 400, statusMessage: "Which branch? The id is missing." });

  const body = (await readBody<UpdateCompanyBody>(event)) || {};
  const service = getServiceClient();

  const existing = await service.from("companies").select("id, name, code").eq("id", id).maybeSingle();
  if (existing.error) throw new Error(existing.error.message);
  if (!existing.data) throw createError({ statusCode: 404, statusMessage: "That branch no longer exists." });

  const patch: Record<string, unknown> = {};

  if (body.name !== undefined) {
    const name = String(body.name).trim();
    if (name.length < 3) {
      throw createError({ statusCode: 400, statusMessage: "Give the branch a name of at least 3 characters." });
    }
    patch.name = name;
  }
  if (body.description !== undefined) {
    patch.description = String(body.description || "").trim() || null;
  }
  if (body.color !== undefined) {
    const color = String(body.color).trim();
    if (!HEX.test(color)) throw createError({ statusCode: 400, statusMessage: "Pick a colour like #d71939." });
    patch.color = color;
  }
  if (body.isActive !== undefined) {
    patch.is_active = Boolean(body.isActive);
  }

  if (!Object.keys(patch).length) {
    throw createError({ statusCode: 400, statusMessage: "Nothing to change." });
  }

  const saved = await service.from("companies").update(patch).eq("id", id).select("id, name, code, description, color, is_active").single();
  if (saved.error) {
    throw createError({ statusCode: 400, statusMessage: `Could not save those changes: ${saved.error.message}` });
  }

  const row = saved.data as Record<string, unknown>;
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