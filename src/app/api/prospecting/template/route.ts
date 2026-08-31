import { NextResponse } from "next/server";
import { getCurrentAccount, toErrorResponse } from "@/lib/auth/account";
import { buildTemplateCsv } from "@/lib/prospecting/external-import";

/**
 * GET /api/prospecting/template
 *
 * Downloadable CSV with the exact columns the paste/upload import path
 * expects — any member (viewer+) may read, matching the rest of the
 * module's read tier. Pure static content, no DB query needed beyond
 * confirming the caller belongs to an account.
 */
export async function GET() {
  try {
    await getCurrentAccount();
    const csv = buildTemplateCsv();
    return new NextResponse(csv, {
      status: 200,
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": 'attachment; filename="modelo-prospeccao.csv"',
      },
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}
