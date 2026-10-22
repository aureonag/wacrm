// POST   /api/operational/affiliates/clients/:id/users/:userRowId/avatar — set the photo
// DELETE /api/operational/affiliates/clients/:id/users/:userRowId/avatar — remove it
//
// Who: each person for their OWN photo; the Aureon team or a store person with
// team permission for anyone of that store. The file goes to the public
// `avatars` bucket (folder aff-store/<store>/) through the service role — the
// upload is checked here (real PNG/JPEG/WebP, up to 2 MB), never trusted from
// the browser.

import { NextResponse } from "next/server";
import { toErrorResponse } from "@/lib/auth/account";
import { isModuleNotReady, moduleNotReadyResponse, requireClientAccess, writeAudit } from "@/lib/affiliates/admin";
import { isUuid } from "@/lib/affiliates/campaigns";
import { AVATAR_BUCKET, AVATAR_MAX_BYTES, avatarPath, avatarPathFromUrl, detectImageType } from "@/lib/affiliates/avatar";
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from "@/lib/rate-limit";

type Params = { params: Promise<{ id: string; userRowId: string }> };

/** Finds the person's row and checks the caller may change it. */
async function authorize(id: string, userRowId: string) {
  const access = await requireClientAccess(id, []);
  const { admin, ctx, kind } = access;

  const found = await admin
    .from("aff_client_users")
    .select("id, user_id, name, avatar_url")
    .eq("id", userRowId)
    .eq("client_id", id)
    .maybeSingle();
  if (found.error) return { error: isModuleNotReady(found.error) ? moduleNotReadyResponse() : NextResponse.json({ error: "Failed" }, { status: 500 }) };
  if (!found.data) return { error: NextResponse.json({ error: "Not found" }, { status: 404 }) };

  // Someone else's photo needs team permission (the guard throws 403 otherwise).
  if (kind === "client" && found.data.user_id !== ctx.userId) await requireClientAccess(id, [["team", "edit"]]);

  return { admin, ctx, row: found.data as { id: string; name: string; avatar_url: string | null } };
}

export async function POST(req: Request, { params }: Params) {
  try {
    const { id, userRowId } = await params;
    if (!isUuid(id) || !isUuid(userRowId)) return NextResponse.json({ error: "Not found" }, { status: 404 });
    const auth = await authorize(id, userRowId);
    if ("error" in auth) return auth.error;
    const { admin, ctx, row } = auth;

    const limit = checkRateLimit(`aff-avatar:${ctx.userId}`, RATE_LIMITS.affiliatePortalWrite);
    if (!limit.success) return rateLimitResponse(limit);

    const form = await req.formData().catch(() => null);
    const file = form?.get("file");
    if (!(file instanceof File)) return NextResponse.json({ error: "Envie uma imagem." }, { status: 400 });
    if (file.size === 0 || file.size > AVATAR_MAX_BYTES) {
      return NextResponse.json({ error: "A imagem deve ter até 2 MB." }, { status: 400 });
    }
    const buffer = Buffer.from(await file.arrayBuffer());
    const type = detectImageType(buffer);
    if (!type) return NextResponse.json({ error: "Use uma imagem PNG, JPG ou WebP." }, { status: 400 });

    const path = avatarPath(id, userRowId, type.ext);
    const up = await admin.storage.from(AVATAR_BUCKET).upload(path, buffer, {
      contentType: type.mime,
      cacheControl: "31536000",
      upsert: false,
    });
    if (up.error) {
      console.error("[users/avatar] upload failed:", up.error.message);
      return NextResponse.json({ error: "Não foi possível enviar a foto. Tente novamente." }, { status: 502 });
    }
    const { data: pub } = admin.storage.from(AVATAR_BUCKET).getPublicUrl(path);

    const saved = await admin.from("aff_client_users").update({ avatar_url: pub.publicUrl }).eq("id", userRowId).eq("client_id", id);
    if (saved.error) {
      await admin.storage.from(AVATAR_BUCKET).remove([path]);
      console.error("[users/avatar] save failed:", saved.error.message);
      return NextResponse.json({ error: "Failed to save the photo" }, { status: 500 });
    }

    const old = avatarPathFromUrl(row.avatar_url, id);
    if (old) await admin.storage.from(AVATAR_BUCKET).remove([old]);

    await writeAudit(admin, ctx, { clientId: id, action: "Atualizou a foto de uma pessoa da equipe", objectType: "client_user", objectId: userRowId });
    return NextResponse.json({ avatar_url: pub.publicUrl });
  } catch (err) {
    return toErrorResponse(err);
  }
}

export async function DELETE(_req: Request, { params }: Params) {
  try {
    const { id, userRowId } = await params;
    if (!isUuid(id) || !isUuid(userRowId)) return NextResponse.json({ error: "Not found" }, { status: 404 });
    const auth = await authorize(id, userRowId);
    if ("error" in auth) return auth.error;
    const { admin, ctx, row } = auth;

    const saved = await admin.from("aff_client_users").update({ avatar_url: null }).eq("id", userRowId).eq("client_id", id);
    if (saved.error) return NextResponse.json({ error: "Failed to remove the photo" }, { status: 500 });

    const old = avatarPathFromUrl(row.avatar_url, id);
    if (old) await admin.storage.from(AVATAR_BUCKET).remove([old]);

    await writeAudit(admin, ctx, { clientId: id, action: "Removeu a foto de uma pessoa da equipe", objectType: "client_user", objectId: userRowId });
    return NextResponse.json({ avatar_url: null });
  } catch (err) {
    return toErrorResponse(err);
  }
}
