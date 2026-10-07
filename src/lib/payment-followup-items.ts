import type { PaymentFollowupInvoiceRow } from "@/types/odoo";

type MoveType = PaymentFollowupInvoiceRow["moveType"];

/** Open items on the Payment Followup list, named the way Odoo's Aged Receivable / Aged Payable report names them. */
export function documentTypeLabel(moveType: MoveType) {
    switch (moveType) {
        case "out_refund":
            return "Credit Note";
        case "miscEntry":
            return "Journal Entry";
        case "payment":
            return "Payment / Entry";
        case "vendorBill":
            return "Vendor Bill";
        case "vendorRefund":
            return "Vendor Refund";
        default:
            return "Invoice";
    }
}

/** Items that reduce what the customer owes us (credit notes, payments received, bills we owe them). */
export function isCreditSide(moveType: MoveType) {
    return moveType === "out_refund" || moveType === "payment" || moveType === "vendorBill";
}

/** The residual with its effect on the customer's balance: charges positive, credits negative. */
export function signedResidual(row: Pick<PaymentFollowupInvoiceRow, "moveType" | "amountResidual">) {
    return isCreditSide(row.moveType) ? -row.amountResidual : row.amountResidual;
}

export function documentBadgeClass(moveType: MoveType) {
    switch (moveType) {
        case "out_refund":
            return "bg-emerald-100 text-emerald-800";
        case "payment":
            return "bg-teal-100 text-teal-800";
        case "miscEntry":
            return "bg-sky-100 text-sky-800";
        case "vendorBill":
        case "vendorRefund":
            return "bg-violet-100 text-violet-800";
        default:
            return "bg-(--chip) text-(--ink-soft)";
    }
}
