// What the coupon in the store should look like for a participant. Pure.

export interface CouponCampaign {
  status: "active" | "inactive";
  discount_type: "PERCENTAGE" | "CURRENCY";
  discount: number | string;
  start_date: string;
  end_date: string | null;
}

export interface CouponPayload {
  code: string;
  type: "percentage" | "absolute";
  value: string;
  start_date: string;
  end_date?: string;
}

/** A coupon exists in the store only while the participant is approved AND the campaign is active. */
export function couponShouldExist(membershipStatus: string, campaignStatus: string): boolean {
  return membershipStatus === "approved" && campaignStatus === "active";
}

export function buildCouponPayload(code: string, campaign: CouponCampaign): CouponPayload {
  const payload: CouponPayload = {
    code: code.toUpperCase(),
    type: campaign.discount_type === "PERCENTAGE" ? "percentage" : "absolute",
    value: Number(campaign.discount).toFixed(2),
    start_date: campaign.start_date,
  };
  if (campaign.end_date) payload.end_date = campaign.end_date;
  return payload;
}
