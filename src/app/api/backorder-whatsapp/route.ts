import { NextResponse } from "next/server";
import { getOdooCredentialsFromRequest } from "@/lib/server/auth-helpers";

interface WhatsAppRequestBody {
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
        const body = (await request.json()) as WhatsAppRequestBody;
        const { credentials } = await getOdooCredentialsFromRequest(request);

        if (!credentials) {
            throw new Error("Odoo credentials not configured.");
        }

        const { orderName, customerName, salespersonName, products } = body;

        // Build product list for WhatsApp
        const productList = products
            .map((p) => `• ${p.name}: ${p.availableQty}/${p.orderedQty} units`)
            .join("\n");

        const whatsAppMessage = `
🎯 *Backorder Ready - ${orderName}*

Hi ${salespersonName},

We are ready to proceed with the backorder for *${customerName}*.

📦 *Products in Stock:*
${productList}

📋 Order: ${orderName}

Please process this order at your earliest convenience.

Thank you!
        `.trim();

        // For now, we're logging the message that would be sent
        // In production, integrate with Twilio, WhatsApp Business API, or similar
        console.log("WhatsApp message would be sent:", {
            to: "+971XXXXXXXXX", // In production, fetch actual phone from Odoo user
            message: whatsAppMessage,
        });

        return NextResponse.json({
            success: true,
            message: "WhatsApp notification prepared (integration needed with WhatsApp service)",
        });
    } catch (error) {
        return NextResponse.json(
            {
                error: error instanceof Error ? error.message : "Failed to send WhatsApp notification",
            },
            { status: 400 }
        );
    }
}
