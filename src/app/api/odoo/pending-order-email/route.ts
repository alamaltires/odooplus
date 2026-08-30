import { NextResponse } from "next/server";
import nodemailer from "nodemailer";
import { getUserIdFromRequest } from "@/lib/server/auth-helpers";

type PendingOrderEmailRequest = {
    orderId: number;
    orderNumber: string;
    customerName: string;
    salespersonName: string;
    previousStatus: string;
    currentStatus: string;
    products: Array<{
        name: string;
        orderedQuantity: number;
        availableQuantity: number;
        shortage: number;
    }>;
};

function escapeHtml(value: string) {
    return value
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/\"/g, "&quot;")
        .replace(/'/g, "&#39;");
}

function formatStatus(value: string) {
    const normalized = value.trim().toLowerCase();

    if (normalized === "pendding") {
        return "Pending";
    }

    if (normalized === "procced") {
        return "Procced";
    }

    return normalized.charAt(0).toUpperCase() + normalized.slice(1);
}

function buildEmailHtml(payload: PendingOrderEmailRequest) {
    const productRows = payload.products
        .map(
            (product) => `
                <tr>
                    <td style="padding:12px 0;border-bottom:1px solid #e7edf4;">
                        <div style="font-weight:600;color:#0f2742;margin-bottom:4px;">${escapeHtml(product.name)}</div>
                        <div style="font-size:13px;color:#4d647d;">
                            Ordered ${Number(product.orderedQuantity).toLocaleString()} · Available ${Number(product.availableQuantity).toLocaleString()} · Shortage ${Number(product.shortage).toLocaleString()}
                        </div>
                    </td>
                </tr>
            `
        )
        .join("");

    return `
<!doctype html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <title>Pending Order Update</title>
</head>
<body style="margin:0;padding:0;background:#f4f7fb;font-family:Arial,Helvetica,sans-serif;color:#102a43;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="padding:20px 12px;background:#f4f7fb;">
    <tr>
      <td align="center">
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:680px;background:#ffffff;border:1px solid #d8e3ef;border-radius:14px;overflow:hidden;">
          <tr>
            <td style="padding:20px 24px;background:linear-gradient(135deg,#0f2f54,#2f7ea4);color:#ffffff;">
              <h1 style="margin:0;font-size:22px;line-height:1.25;">Pending Order Update</h1>
              <p style="margin:8px 0 0;font-size:14px;opacity:0.95;">A browser notification was shown and the store team has been alerted.</p>
            </td>
          </tr>
          <tr>
            <td style="padding:20px 24px;font-size:14px;line-height:1.6;color:#334e68;">
              <p style="margin:0 0 10px;">Hello Store Team,</p>
              <p style="margin:0 0 14px;">
                A pending order changed status and needs attention.
              </p>
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border:1px solid #e3ebf4;border-radius:10px;background:#f8fbff;">
                <tr>
                  <td style="padding:14px 16px;">
                    <p style="margin:0 0 6px;"><strong>Order:</strong> ${escapeHtml(payload.orderNumber)}</p>
                    <p style="margin:0 0 6px;"><strong>Customer:</strong> ${escapeHtml(payload.customerName)}</p>
                    <p style="margin:0 0 6px;"><strong>Salesperson:</strong> ${escapeHtml(payload.salespersonName)}</p>
                    <p style="margin:0 0 6px;"><strong>Status:</strong> ${escapeHtml(formatStatus(payload.previousStatus))} → ${escapeHtml(formatStatus(payload.currentStatus))}</p>
                    <p style="margin:0;"><strong>Order ID:</strong> ${payload.orderId}</p>
                  </td>
                </tr>
              </table>
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="margin-top:16px;border-collapse:collapse;">
                ${productRows || `<tr><td style="padding:12px 0;color:#5f7288;">No product lines were included with this order.</td></tr>`}
              </table>
              <p style="margin:14px 0 0;">Please review the order and proceed as needed.</p>
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

        const body = (await request.json()) as PendingOrderEmailRequest;

        if (
            !Number.isFinite(Number(body.orderId)) ||
            !body.orderNumber ||
            !body.customerName ||
            !body.salespersonName ||
            !body.previousStatus ||
            !body.currentStatus
        ) {
            throw new Error("Missing required pending order email fields.");
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

        const html = buildEmailHtml({
            ...body,
            orderId: Number(body.orderId),
            previousStatus: String(body.previousStatus),
            currentStatus: String(body.currentStatus),
            products: Array.isArray(body.products)
                ? body.products.map((product) => ({
                    name: String(product.name ?? "-"),
                    orderedQuantity: Number(product.orderedQuantity ?? 0),
                    availableQuantity: Number(product.availableQuantity ?? 0),
                    shortage: Number(product.shortage ?? 0),
                }))
                : [],
        });

        await transporter.sendMail({
            from: smtpUser,
            to: "sales@dme-medical.com",
            subject: `Pending Order Update - ${body.orderNumber}`,
            html,
        });

        return NextResponse.json({ success: true });
    } catch (error) {
        return NextResponse.json(
            {
                error: error instanceof Error ? error.message : "Failed to send pending order email",
            },
            { status: 400 }
        );
    }
}