import { defineHandler } from "nitro";
import { clearSessionCookie } from "../../../utils/auth";

export default defineHandler((event) => {
  clearSessionCookie(event);
  return { ok: true };
});
