import { NextResponse } from "next/server";

import { getOfficeContext } from "@/lib/office/access";
import { officeError, officeJson, OFFICE_PRIVATE_HEADERS } from "@/lib/office/http";
import { OfficeAvatarError } from "@/lib/office/runtime/avatar-composition";
import { getOfficeAvatarComposer } from "@/lib/office/runtime/avatar-server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type RouteContext = { params: Promise<{ kind: string; recipe: string }> };

async function respond(request: Request, context: RouteContext, head: boolean) {
  try {
    const identity = await getOfficeContext();
    const { kind, recipe } = await context.params;
    if (new URL(request.url).pathname.includes("%") || !recipe.endsWith(".png")) {
      return officeJson({ error: "Combinação de personagem inválida." }, 400);
    }
    const { bytes } = await getOfficeAvatarComposer(identity).load(kind, recipe.slice(0, -4));
    return new NextResponse(head ? null : new Uint8Array(bytes), {
      headers: { ...OFFICE_PRIVATE_HEADERS, "Content-Type": "image/png", "Content-Length": String(bytes.length) },
    });
  } catch (error) {
    if (error instanceof OfficeAvatarError) {
      return officeJson({ error: error.status === 400 ? "Combinação de personagem inválida." : "Prévia de personagem indisponível." }, error.status);
    }
    return officeError(error);
  }
}
export function GET(request: Request, context: RouteContext) { return respond(request, context, false); }
export function HEAD(request: Request, context: RouteContext) { return respond(request, context, true); }
