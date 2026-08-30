import { NextResponse } from "next/server";
import { getOdooCredentialsFromRequest } from "@/lib/server/auth-helpers";

interface EmailRequestBody {
    orderId: number;
    orderName: string;
    customerName: string;
    salespersonName: string;
    products: Array<{
        name: string;
        orderedQty: number;
        availableQty: number;
    }>;
}

export async function POST(request: Request) {
    try {
        const body = (await request.json()) as EmailRequestBody;
        const { credentials } = await getOdooCredentialsFromRequest(request);

        if (!credentials) {
            throw new Error("Odoo credentials not configured.");
        }

        const { orderName, customerName, salespersonName, products } = body;

        // Build product list for email
        const productList = products
            .map((p) => `• ${p.name}: ${p.availableQty}/${p.orderedQty} units in stock`)
            .join("\n");

        const emailSubject = `Backorder Ready - ${orderName}`;
        const emailBody = `
Hi ${salespersonName},

We are ready to proceed with the backorder for customer ${customerName}.

The following products are now in stock:

${productList}

Order Number: ${orderName}

Please process this order at your earliest convenience.

Best regards,
Sales Hub Team
        `.trim();

        // For now, we're logging the email that would be sent
        // In production, integrate with SendGrid, AWS SES, or another email service
        console.log("Email would be sent:", {
            to: "salesperson@example.com", // In production, fetch actual email from Odoo user
            subject: emailSubject,
            body: emailBody,
        });

        return NextResponse.json({
            success: true,
            message: "Email notification prepared (integration needed with email service)",
        });
    } catch (error) {
        return NextResponse.json(
            {
                error: error instanceof Error ? error.message : "Failed to send email notification",
            },
            { status: 400 }
        );
    }
}
