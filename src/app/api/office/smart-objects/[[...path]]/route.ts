import { getOfficeContext } from "@/lib/office/access";
import { officeBody, officeError, officeJson, requireOfficeIdentity } from "@/lib/office/http";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

async function unavailable(request: Request) {
  try {
    const identity = await getOfficeContext();
    requireOfficeIdentity(request, identity);
    if (request.method === "POST") await officeBody(request);
    return officeJson({
      error: "As integrações externas de objetos estarão disponíveis em uma próxima etapa.",
      code: "OFFICE_FEATURE_UNAVAILABLE",
    }, 503);
  } catch (error) {
    return officeError(error);
  }
}
export const GET = unavailable;
export const POST = unavailable;
