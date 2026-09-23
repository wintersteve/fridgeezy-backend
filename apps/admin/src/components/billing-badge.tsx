import type { ImageBillingPath } from "@fridgeezy/admin-contract";

import { Pill } from "./ui";

/**
 * Which Google budget the buttons on this page spend.
 *
 * Shown beside the cost, not tucked into a settings screen, because the two
 * backends draw the same picture out of two different budgets and nothing else
 * on the page says which: AI Studio bills a prepay balance, Vertex bills a
 * Cloud project and so can be paid for with Cloud credit.
 *
 * **Vertex is the quiet state and AI Studio is the loud one**, which is the
 * opposite of how a status badge usually reads. Vertex is what these screens
 * are meant to be on — it is where the credit is — so it gets the neutral
 * treatment. Falling back to the API key is the case worth noticing, because it
 * is invisible in every other way: the render succeeds, the picture is
 * identical, and the wrong account is billed.
 */
export function BillingBadge({ billing }: { billing: ImageBillingPath }) {
    if (billing.vertex) {
        return (
            <span className="billing-badge">
                <Pill tone="info">Vertex</Pill>
                <span className="cell-sub">
                    billed to {billing.project}
                    {billing.location && billing.location !== "global"
                        ? ` · ${billing.location}`
                        : ""}
                </span>
            </span>
        );
    }

    return (
        <span className="billing-badge">
            <Pill tone="accent">AI Studio</Pill>
            <span className="cell-sub">
                billed to the API key's prepay balance — set GOOGLE_CLOUD_PROJECT to
                use Cloud credit
            </span>
        </span>
    );
}
