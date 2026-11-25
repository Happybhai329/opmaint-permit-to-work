import { redirect } from "next/navigation";
import { currentUser, type SessionUser } from "./auth";

/** Every page and API handler starts here. The cookie is the only identity source. */
export async function requireUser(): Promise<SessionUser> {
  const user = await currentUser();
  if (!user) redirect("/login");
  return user;
}

/** For route handlers: no redirect, a 401 the client has to deal with. */
export async function requireApiUser(): Promise<
  { ok: true; user: SessionUser } | { ok: false; response: Response }
> {
  const user = await currentUser();
  if (!user) {
    return {
      ok: false,
      response: Response.json({ error: "Not signed in." }, { status: 401 }),
    };
  }
  return { ok: true, user };
}
