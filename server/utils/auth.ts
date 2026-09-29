import { createHmac, timingSafeEqual } from "node:crypto";
import { Pool } from "pg";
import { useRuntimeConfig } from "nitro/runtime-config";
import { deleteCookie, getCookie, setCookie } from "nitro/h3";

export type SessionUser = {
  id: string;
  email: string;
  fullName: string;
  role: string;
};

type SessionPayload = SessionUser & { exp: number };

let pool: Pool | undefined;

const getPool = () => {
  const config = useRuntimeConfig();
  if (!config.databaseUrl) throw new Error("NITRO_DATABASE_URL is not configured");
  pool ??= new Pool({ connectionString: config.databaseUrl });
  return pool;
};

const getSecret = () => {
  const config = useRuntimeConfig();
  if (!config.sessionSecret) throw new Error("NITRO_SESSION_SECRET is not configured");
  return config.sessionSecret;
};

const encode = (value: string) => Buffer.from(value).toString("base64url");
const decode = (value: string) => Buffer.from(value, "base64url").toString("utf8");

const sign = (value: string) => createHmac("sha256", getSecret()).update(value).digest("base64url");

export const database = () => getPool();

export const createSession = (user: SessionUser) => {
  const payload: SessionPayload = { ...user, exp: Date.now() + 1000 * 60 * 60 * 8 };
  const encoded = encode(JSON.stringify(payload));
  return `${encoded}.${sign(encoded)}`;
};

export const setSessionCookie = (event: Parameters<typeof setCookie>[0], token: string) => {
  setCookie(event, "lh_session", token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: 60 * 60 * 8,
    path: "/",
  });
};

export const clearSessionCookie = (event: Parameters<typeof deleteCookie>[0]) => deleteCookie(event, "lh_session", { path: "/" });

export const readSession = (event: Parameters<typeof getCookie>[0]): SessionUser | null => {
  const token = getCookie(event, "lh_session");
  if (!token) return null;
  const [encoded, signature] = token.split(".");
  if (!encoded || !signature) return null;
  const expected = sign(encoded);
  const signatureBuffer = Buffer.from(signature);
  const expectedBuffer = Buffer.from(expected);
  if (signatureBuffer.length !== expectedBuffer.length || !timingSafeEqual(signatureBuffer, expectedBuffer)) return null;
  try {
    const payload = JSON.parse(decode(encoded)) as SessionPayload;
    if (payload.exp < Date.now()) return null;
    return { id: payload.id, email: payload.email, fullName: payload.fullName, role: payload.role };
  } catch {
    return null;
  }
};
