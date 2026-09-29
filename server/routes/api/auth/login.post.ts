import { defineHandler } from "nitro";
import { useRuntimeConfig } from "nitro/runtime-config";
import { createError, readBody, setResponseStatus } from "nitro/h3";
import { createSession, database, setSessionCookie, type SessionUser } from "../../../utils/auth";

export default defineHandler(async (event) => {
  const body = await readBody<{ email?: string; password?: string }>(event);
  const email = body?.email?.trim().toLowerCase();
  const password = body?.password;

  if (!email || !password) {
    throw createError({ statusCode: 400, statusMessage: "Email and password are required." });
  }

  try {
    const result = await database().query<SessionUser>(
      `SELECT id, email, full_name AS "fullName", role
       FROM users
       WHERE lower(email) = $1
         AND password_hash = crypt($2, password_hash)
         AND is_active = true
       LIMIT 1`,
      [email, password],
    );
    const user = result.rows[0];

    if (!user) {
      throw createError({ statusCode: 401, statusMessage: "Invalid email or password." });
    }

    await database().query("UPDATE users SET last_login_at = now() WHERE id = $1", [user.id]);
    setSessionCookie(event, createSession(user));
    setResponseStatus(event, 200);
    return { user };
  } catch (error) {
    if (error && typeof error === "object" && "statusCode" in error) throw error;
    const config = useRuntimeConfig();
    const message = config.databaseUrl ? "Unable to reach the PostgreSQL database." : "PostgreSQL authentication is not configured yet.";
    throw createError({ statusCode: 503, statusMessage: message });
  }
});
