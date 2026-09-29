import { defineHandler } from "nitro";
import { createError } from "nitro/h3";
import { readSession } from "../../../utils/auth";

export default defineHandler((event) => {
  const user = readSession(event);
  if (!user) throw createError({ statusCode: 401, statusMessage: "Authentication required." });
  return { user };
});
