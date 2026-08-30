import { NextResponse } from "next/server";
import nodemailer from "nodemailer";
import { getUserIdFromRequest } from "@/lib/server/auth-helpers";

type SalesTargetEmailRow = {
    categoryName: string;
    targetAmount: number;
    achieved: number;
    progress: number;
    remaining: number;
};

type SalesTargetEmailRequest = {
    toEmail: string;
    salespersonName: string;
    monthLabel: string;
    year: number;
    totalInvoiced: number;
    totalTargetAmount: number;
    rows: SalesTargetEmailRow[];
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

function buildEmailHtml(payload: SalesTargetEmailRequest) {
    const overallProgress =
        payload.totalTargetAmount > 0
            ? Math.min((payload.totalInvoiced / payload.totalTargetAmount) * 100, 100)
            : 0;
    const overallRemaining = Math.max(0, payload.totalTargetAmount - payload.totalInvoiced);

    const rowsHtml = payload.rows
        .map((row) => {
            const progress = Math.max(0, Math.min(row.progress, 100));
            return `
                <tr>
                    <td style="padding: 12px 0; border-bottom: 1px solid #e7edf4;">
                        <div style="font-weight: 600; color: #0f2742; margin-bottom: 6px;">${escapeHtml(row.categoryName)}</div>
                        <div style="font-size: 13px; color: #4d647d; margin-bottom: 8px;">
                            ${formatCurrency(row.achieved)} / ${formatCurrency(row.targetAmount)}
                        </div>
                        <div style="background: #e7edf4; border-radius: 999px; height: 8px; overflow: hidden;">
                            <div style="width: ${progress}%; height: 8px; background: linear-gradient(90deg, #2ca58d, #2f7ea4);"></div>
                        </div>
                        <div style="margin-top: 8px; font-size: 12px; color: #5f7288; display: flex; justify-content: space-between; gap: 12px;">
                            <span>${progress.toFixed(1)}% achieved</span>
                            <span>${formatCurrency(row.remaining)} remaining</span>
                        </div>
                    </td>
                </tr>
            `;
        })
        .join("");

    return `
<!doctype html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <title>Sales Targets Report</title>
</head>
<body style="margin:0;padding:0;background:#f3f7fb;font-family:Arial,Helvetica,sans-serif;color:#102a43;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f3f7fb;padding:20px 12px;">
    <tr>
      <td align="center">
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:700px;background:#ffffff;border:1px solid #d9e4ef;border-radius:16px;overflow:hidden;">
          <tr>
            <td style="padding:24px;background:linear-gradient(135deg,#10375a,#2f7ea4);color:#ffffff;">
              <h1 style="margin:0;font-size:24px;line-height:1.3;">Salesperson Sales Target</h1>
              <p style="margin:8px 0 0;font-size:14px;opacity:0.95;">${escapeHtml(payload.salespersonName)} • ${escapeHtml(payload.monthLabel)} ${payload.year}</p>
            </td>
          </tr>

          <tr>
            <td style="padding:20px 24px 0;">
              <h2 style="margin:0 0 8px;font-size:20px;color:#0f2742;">Set Monthly Targets</h2>
              <p style="margin:0;font-size:14px;color:#5f7288;">Saved category targets and their achieved values.</p>
            </td>
          </tr>

          <tr>
            <td style="padding:8px 24px 0;">
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border-collapse:collapse;">
                ${rowsHtml || `<tr><td style="padding:12px 0;color:#5f7288;">No category targets saved for this period.</td></tr>`}
              </table>
            </td>
          </tr>

          <tr>
            <td style="padding:22px 24px 0;">
              <h2 style="margin:0 0 10px;font-size:20px;color:#0f2742;">Performance Against Target</h2>
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border:1px solid #d9e4ef;border-radius:12px;background:#f8fbff;">
                <tr>
                  <td style="padding:16px;">
                    <table role="presentation" width="100%" cellspacing="0" cellpadding="0">
                      <tr>
                        <td style="font-size:14px;color:#5f7288;">Target Progress</td>
                        <td align="right" style="font-size:14px;color:#5f7288;">Target</td>
                      </tr>
                      <tr>
                        <td style="padding-top:4px;font-size:26px;font-weight:700;color:#0f2742;">${formatCurrency(payload.totalInvoiced)}</td>
                        <td align="right" style="padding-top:4px;font-size:20px;font-weight:600;color:#0f2742;">${formatCurrency(payload.totalTargetAmount)}</td>
                      </tr>
                    </table>
                    <div style="margin-top:12px;background:#e7edf4;border-radius:999px;height:10px;overflow:hidden;">
                      <div style="width:${overallProgress}%;height:10px;background:linear-gradient(90deg,#2ca58d,#2f7ea4);"></div>
                    </div>
                    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="margin-top:8px;font-size:12px;color:#5f7288;">
                      <tr>
                        <td>${overallProgress.toFixed(1)}% achieved</td>
                        <td align="right">${formatCurrency(overallRemaining)} remaining</td>
                      </tr>
                    </table>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <tr>
            <td style="padding:20px 24px 24px;color:#5f7288;font-size:12px;">
              Generated automatically from OdooPlus Sales Targets.
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

        const body = (await request.json()) as SalesTargetEmailRequest;

        if (!body.toEmail || !body.salespersonName || !body.monthLabel || !Number.isFinite(body.year)) {
            throw new Error("Missing required email report fields.");
        }

        const rows = Array.isArray(body.rows) ? body.rows : [];
        const html = buildEmailHtml({ ...body, rows });

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

        await transporter.sendMail({
            from: smtpUser,
            to: body.toEmail,
            subject: `Sales Targets - ${body.salespersonName} - ${body.monthLabel} ${body.year}`,
            html,
        });

        return NextResponse.json({ success: true });
    } catch (error) {
        return NextResponse.json(
            {
                error: error instanceof Error ? error.message : "Failed to send sales target email",
            },
            { status: 400 }
        );
    }
}
