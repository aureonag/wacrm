// POST   /api/operational/reportei/clients/:id/logo — set the client's photo (multipart "file")
// DELETE /api/operational/reportei/clients/:id/logo — remove it
//
// Needs edit_boards. The file goes to the public `avatars` bucket (folder
// reportei-clients/<client>/) through the service role; the upload is checked
// here (a real PNG/JPEG/WebP, up to 2 MB), never trusted from the browser.

import { NextResponse } from "next/server";
import { toErrorResponse } from "@/lib/auth/account";
import { requirePermission } from "@/lib/auth/require-permission";
import { detectImageType } from "@/lib/affiliates/avatar";
import { supabaseAdmin } from "@/lib/contracts/admin-client";
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from "@/lib/rate-limit";
import { LOGO_BUCKET, LOGO_MAX_BYTES, logoPath, logoPathFromUrl } from "@/lib/reportei/client-card";
import { isUuid } from "@/lib/reportei/template-store";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

export async function POST(req: Request, { params }: Ctx) {
  try {
    const ctx = await requirePermission("operational", "tasks", "edit_boards");
    const { id } = await params;
    if (!isUuid(id)) return NextResponse.json({ error: "Not found" }, { status: 404 });

    const limit = checkRateLimit(`reportei-logo:${ctx.userId}`, RATE_LIMITS.affiliatePortalWrite);
    if (!limit.success) return rateLimitResponse(limit);

    const client = await ctx.supabase.from("ops_clients").select("id").eq("id", id).eq("account_id", ctx.accountId).maybeSingle();
    if (client.error) return NextResponse.json({ error: "Failed to load client" }, { status: 500 });
    if (!client.data) return NextResponse.json({ error: "Not found" }, { status: 404 });

    const form = await req.formData().catch(() => null);
    const file = form?.get("file");
    if (!(file instanceof File)) return NextResponse.json({ error: "Envie uma imagem." }, { status: 400 });
    if (file.size === 0 || file.size > LOGO_MAX_BYTES) return NextResponse.json({ error: "A imagem deve ter até 2 MB." }, { status: 400 });
    const buffer = Buffer.from(await file.arrayBuffer());
    const type = detectImageType(buffer);
    if (!type) return NextResponse.json({ error: "Use uma imagem PNG, JPG ou WebP." }, { status: 400 });

    const admin = supabaseAdmin();
    const previous = await ctx.supabase.from("reportei_client_logos").select("logo_url").eq("client_id", id).eq("account_id", ctx.accountId).maybeSingle();

    const path = logoPath(id, type.ext);
    const up = await admin.storage.from(LOGO_BUCKET).upload(path, buffer, { contentType: type.mime, cacheControl: "31536000", upsert: false });
    if (up.error) {
      console.error("[reportei logo] upload failed:", up.error.message);
      return NextResponse.json({ error: "Não foi possível enviar a foto. Tente novamente." }, { status: 502 });
    }
    const { data: pub } = admin.storage.from(LOGO_BUCKET).getPublicUrl(path);

    const saved = await ctx.supabase
      .from("reportei_client_logos")
      .upsert({ client_id: id, account_id: ctx.accountId, logo_url: pub.publicUrl, updated_by: ctx.userId }, { onConflict: "client_id" });
    if (saved.error) {
      await admin.storage.from(LOGO_BUCKET).remove([path]);
      console.error("[reportei logo] save failed:", saved.error.message);
      return NextResponse.json({ error: "Failed to save the photo" }, { status: 500 });
    }

    const old = logoPathFromUrl(previous.data?.logo_url as string | undefined, id);
    if (old) await admin.storage.from(LOGO_BUCKET).remove([old]);

    return NextResponse.json({ logoUrl: pub.publicUrl });
  } catch (err) {
    return toErrorResponse(err);
  }
}

export async function DELETE(_req: Request, { params }: Ctx) {
  try {
    const ctx = await requirePermission("operational", "tasks", "edit_boards");
    const { id } = await params;
    if (!isUuid(id)) return NextResponse.json({ error: "Not found" }, { status: 404 });

    const previous = await ctx.supabase.from("reportei_client_logos").select("logo_url").eq("client_id", id).eq("account_id", ctx.accountId).maybeSingle();
    const { error } = await ctx.supabase.from("reportei_client_logos").delete().eq("client_id", id).eq("account_id", ctx.accountId);
    if (error) {
      console.error("[reportei logo] delete failed:", error.message);
      return NextResponse.json({ error: "Failed to remove the photo" }, { status: 500 });
    }
    const old = logoPathFromUrl(previous.data?.logo_url as string | undefined, id);
    if (old) await supabaseAdmin().storage.from(LOGO_BUCKET).remove([old]);

    return NextResponse.json({ logoUrl: null });
  } catch (err) {
    return toErrorResponse(err);
  }
}
