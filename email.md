**Subject:** Please test: new "Unlinked Adjustments" cost in Margin Analytics

Hi team,

We've added a new cost component to **Margin Analytics** and would like your help testing it before we rely on it.

**What changed**

Some products have inventory valuation entries that raise or lower the cost but have no Reference and no Source Document. Typically these are past cost corrections. Margin Analytics couldn't see them before, because it only looked at costs tied to a purchase order. Margin Analytics now includes them as a fourth cost component, **Unlinked Adjustments**, and adds them to the average total cost per unit. Margin and profit/loss are calculated from that figure.

**Where to find it**

- **Summary tiles:** a new "Unlinked Adj." tile.
- **Each product row:** expand it to see the new "Unlinked adjustments" card.
- **Product breakdown:** a new "Unlinked Valuation Adjustments" section listing each entry.
- **Excel exports:** a new column in the main export and a new sheet in the breakdown export.

**Please test**

1. Open **Margin Analytics** and search for **385/65R22.5 BRIDGESTONE R168 160/158 K/L 18PR Thailand**, with Unified Lot **L-2026** selected and a date range that includes 07/09/2026 and 04/10/2026.
2. Open the product breakdown and check that the Unlinked Valuation Adjustments section shows the three entries:
   - +82,022.40 AED (07/09/2026)
   - +71,769.60 AED (07/09/2026)
   - −32,672.33 AED (04/10/2026)
   - The net is about +121,119.67 AED.
3. Check that the average total cost per unit now includes this amount.
4. Try a product that has no such entries. Its Unlinked Adjustments should be 0, and its cost should be the same as before.
5. Try a few other filters (category, brand, no lot selected) and confirm nothing looks wrong.
6. Export to Excel and check the new column and sheet.

**What we need back**

- Any product where the Unlinked Adjustments figure looks wrong, with the product name, the filters you used and a screenshot.
- Whether the lot-filtered view shows **0** for a lot you know has such entries.
- Whether the 04/10/2026 entry (−32,672.33) should reduce cost, or whether it's a reversal we shouldn't count.

Please send your findings by **[date]**. Reply to this email with any questions.

Thanks,
[Your name]
