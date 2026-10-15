import { getOfficeContext } from "@/lib/office/access";
import { officeError, officeJson } from "@/lib/office/http";
import { getOfficeService } from "@/lib/office/runtime/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  try {
    const identity = await getOfficeContext();
    const data = await getOfficeService().requestAsCrm(identity, "GET", "/bootstrap");
    return officeJson({ identity, map: data.map, clientState: data.clientState });
  } catch (error) {
    return officeError(error);
  }
}
