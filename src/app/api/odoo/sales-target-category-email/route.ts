import { NextResponse } from "next/server";
import nodemailer from "nodemailer";
import { getUserIdFromRequest } from "@/lib/server/auth-helpers";

type SalesTargetCategoryEmailRequest = {
    salespersonName: string;
    monthLabel: string;
    year: number;
    categoryName: string;
    targetAmount: number;
    achieved: number;
    remaining: number;
};

function formatNumber(value: number) {
    return value.toLocaleString(undefined, {
        minimumFractionDigits: 0,
        maximumFractionDigits: 2,
    });
}

function formatCurrency(value: number) {
    return `AED ${formatNumber(value)}`;
}

function escapeHtml(value: string) {
    return value
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/\"/g, "&quot;")
        .replace(/'/g, "&#39;");
}

function buildCategoryMarketingEmailHtml(payload: SalesTargetCategoryEmailRequest) {
    return `
<!doctype html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <title>Category Marketing Support Request</title>
</head>
<body style="margin:0;padding:0;background:#f4f7fb;font-family:Arial,Helvetica,sans-serif;color:#102a43;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="padding:20px 12px;background:#f4f7fb;">
    <tr>
      <td align="center">
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:680px;background:#ffffff;border:1px solid #d8e3ef;border-radius:14px;overflow:hidden;">
          <tr>
            <td style="padding:20px 24px;background:linear-gradient(135deg,#0f2f54,#2f7ea4);color:#ffffff;">
              <h1 style="margin:0;font-size:22px;line-height:1.25;">Marketing Support Request</h1>
              <p style="margin:8px 0 0;font-size:14px;opacity:0.95;">Product category campaign request from Sales Targets</p>
            </td>
          </tr>
          <tr>
            <td style="padding:20px 24px;font-size:14px;line-height:1.6;color:#334e68;">
              <p style="margin:0 0 10px;">Hello Marketing Team,</p>
              <p style="margin:0 0 14px;">
                Please support this product category with a focused marketing action by preparing a promo and/or sending a targeted broadcast
                to the salesperson's customers as a reminder for this category.
              </p>
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border:1px solid #e3ebf4;border-radius:10px;background:#f8fbff;">
                <tr>
                  <td style="padding:14px 16px;">
                    <p style="margin:0 0 6px;"><strong>Salesperson:</strong> ${escapeHtml(payload.salespersonName)}</p>
                    <p style="margin:0 0 6px;"><strong>Period:</strong> ${escapeHtml(payload.monthLabel)} ${payload.year}</p>
                    <p style="margin:0 0 6px;"><strong>Category:</strong> ${escapeHtml(payload.categoryName)}</p>
                    <p style="margin:0 0 6px;"><strong>Target:</strong> ${formatCurrency(payload.targetAmount)}</p>
                    <p style="margin:0 0 6px;"><strong>Achieved:</strong> ${formatCurrency(payload.achieved)}</p>
                    <p style="margin:0;"><strong>Remaining:</strong> ${formatCurrency(payload.remaining)}</p>
                  </td>
                </tr>
              </table>
              <p style="margin:14px 0 0;">Thank you.</p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>
`;
}

export async function POST(request: Request) {
    try {
        await getUserIdFromRequest(request);
        const body = (await request.json()) as SalesTargetCategoryEmailRequest;

        if (
            !body.salespersonName ||
            !body.monthLabel ||
            !Number.isFinite(Number(body.year)) ||
            !body.categoryName
        ) {
            throw new Error("Missing required marketing request fields.");
        }

        const smtpHost = process.env.SMTP_HOST;
        const smtpPort = Number(process.env.SMTP_PORT);
        const smtpUser = process.env.SMTP_USER;
        const smtpPass = process.env.SMTP_PASS;

        if (!smtpHost || !Number.isFinite(smtpPort) || smtpPort <= 0 || !smtpUser || !smtpPass) {
            throw new Error("SMTP configuration is missing. Please set SMTP_HOST, SMTP_PORT, SMTP_USER, and SMTP_PASS.");
        }

        const transporter = nodemailer.createTransport({
            host: smtpHost,
            port: smtpPort,
            secure: true,
            auth: {
                user: smtpUser,
                pass: smtpPass,
            },
        });

        const html = buildCategoryMarketingEmailHtml({
            ...body,
            year: Number(body.year),
            targetAmount: Number(body.targetAmount ?? 0),
            achieved: Number(body.achieved ?? 0),
            remaining: Number(body.remaining ?? 0),
        });

        await transporter.sendMail({
            from: smtpUser,
            to: "marketing@dme-medical.com",
            subject: `Marketing Support Request - ${body.categoryName} - ${body.salespersonName} - ${body.monthLabel} ${body.year}`,
            html,
        });

        return NextResponse.json({ success: true });
    } catch (error) {
        return NextResponse.json(
            {
                error: error instanceof Error ? error.message : "Failed to send marketing support request",
            },
            { status: 400 }
        );
    }
}
