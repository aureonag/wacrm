import { getOfficeContext } from "@/lib/office/access";
import { officeBody, officeError, officeJson, officeQuery, requireOfficeIdentity } from "@/lib/office/http";
import { getOfficeService } from "@/lib/office/runtime/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type RouteContext = { params: Promise<{ endpoint: string }> };

async function respond(request: Request, context: RouteContext, method: "GET" | "POST") {
  try {
    const identity = await getOfficeContext();
    requireOfficeIdentity(request, identity);
    const { endpoint } = await context.params;
    const body = method === "POST" ? await officeBody(request) : {};
    const query = officeQuery(request);
    const result = await getOfficeService().requestAsCrm(identity, method, "/" + endpoint, body, query);
    return officeJson(result);
  } catch (error) {
    return officeError(error);
  }
}

export function GET(request: Request, context: RouteContext) { return respond(request, context, "GET"); }
export function POST(request: Request, context: RouteContext) { return respond(request, context, "POST"); }
