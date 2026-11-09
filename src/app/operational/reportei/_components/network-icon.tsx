// Small brand marks for the networks Reportei integrates (Meta Ads, Instagram,
// Facebook, Google Ads, GA4, YouTube, LinkedIn, TikTok), drawn as inline SVG so no
// image files are needed. Decorative: the name is in the tooltip.

import { cn } from "@/lib/utils";

function Frame({ size, className, children }: { size: number; className?: string; children: React.ReactNode }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} className={cn("shrink-0", className)} aria-hidden>
      {children}
    </svg>
  );
}

/** One mark per catalog key; unknown keys get a neutral dot. */
export function NetworkIcon({ network, size = 20, className }: { network: string; size?: number; className?: string }) {
  const p = { size, className };
  switch (network) {
    case "meta_ads":
      return (
        <Frame {...p}>
          <path
            fill="#0866FF"
            d="M6.915 4.03c-1.968 0-3.683 1.28-4.871 3.113C.704 9.208 0 11.883 0 14.449c0 .706.07 1.369.21 1.973a6.624 6.624 0 0 0 .265.86 5.297 5.297 0 0 0 .371.761c.696 1.159 1.818 1.927 3.593 1.927 1.497 0 2.633-.671 3.965-2.444.76-1.012 1.144-1.626 2.663-4.32l.756-1.339.186-.325c.061.1.121.196.183.3l2.152 3.595c.724 1.21 1.665 2.556 2.47 3.314 1.046.987 1.992 1.22 3.06 1.22 1.075 0 1.876-.355 2.455-.843a3.743 3.743 0 0 0 .81-.973c.542-.939.861-2.127.861-3.745 0-2.72-.681-5.357-2.084-7.45-1.282-1.912-2.957-2.93-4.716-2.93-1.047 0-2.088.467-3.053 1.308-.652.57-1.257 1.29-1.82 2.05-.69-.875-1.335-1.547-1.958-2.056-1.182-.966-2.315-1.303-3.454-1.303zm10.16 2.053c1.147 0 2.188.758 2.992 1.999 1.132 1.748 1.647 4.195 1.647 6.4 0 1.548-.368 2.9-1.839 2.9-.58 0-1.027-.23-1.664-1.004-.496-.601-1.343-1.878-2.832-4.358l-.617-1.028a44.908 44.908 0 0 0-1.255-1.98c.07-.109.141-.224.211-.327 1.12-1.667 2.118-2.602 3.358-2.602zm-10.201.553c1.265 0 2.058.791 2.675 1.446.307.327.737.871 1.234 1.579l-1.02 1.566c-.757 1.163-1.882 3.017-2.837 4.338-1.191 1.649-1.81 1.817-2.486 1.817-.524 0-1.038-.237-1.383-.794-.263-.426-.464-1.13-.464-2.046 0-2.221.63-4.535 1.66-6.088.454-.687.964-1.226 1.533-1.533a2.264 2.264 0 0 1 1.088-.285z"
          />
        </Frame>
      );
    case "facebook":
      return (
        <Frame {...p}>
          <circle cx="12" cy="12" r="10" fill="#1877F2" />
          <path d="M13.2 21v-7h2.3l.4-2.8h-2.7V9.5c0-.8.3-1.3 1.4-1.3H16V5.7c-.3 0-1.1-.1-2-.1-2 0-3.4 1.2-3.4 3.5v2.1H8.2V14h2.4v7z" fill="#fff" />
        </Frame>
      );
    case "instagram_business":
      return (
        <Frame {...p}>
          <defs>
            <linearGradient id="ig-grad" x1="0" y1="1" x2="1" y2="0">
              <stop offset="0" stopColor="#FEDA75" />
              <stop offset="0.35" stopColor="#FA7E1E" />
              <stop offset="0.65" stopColor="#D62976" />
              <stop offset="1" stopColor="#4F5BD5" />
            </linearGradient>
          </defs>
          <rect x="2.5" y="2.5" width="19" height="19" rx="5.5" fill="none" stroke="url(#ig-grad)" strokeWidth="2" />
          <circle cx="12" cy="12" r="4.2" fill="none" stroke="url(#ig-grad)" strokeWidth="2" />
          <circle cx="17.3" cy="6.7" r="1.2" fill="#D62976" />
        </Frame>
      );
    case "google_ads":
      return (
        <svg viewBox="0 0 20 20" width={size} height={size} className={cn("shrink-0", className)} aria-hidden>
          <path
            fill="#4285F4"
            d="M7.93174 2.53099C7.56598 2.87622 7.31965 3.30223 7.14051 3.76498C7.00615 4.0294 6.96882 4.32321 6.94643 4.61701C6.9315 5.18993 7.06586 5.73348 7.35698 6.23294C7.67795 6.79117 8.01385 7.34206 8.33482 7.90029L13.5674 16.7512C14.2392 17.897 15.4559 18.4846 16.7547 18.2937C18.8746 17.9778 20.0316 15.6494 18.9642 13.8058C17.6952 11.6022 16.3964 9.40604 15.1125 7.20985C14.3437 5.88772 13.5525 4.58029 12.806 3.24347C11.8133 1.48064 9.39477 1.12807 7.93174 2.53099Z"
          />
          <path
            fill="#FBBC04"
            d="M6.49104 6.73381C6.28351 6.37716 6.13606 6.00226 6.04709 5.61493C4.91159 7.54715 3.77945 9.48266 2.6473 11.4182L2.63086 11.4462C3.0242 11.3188 3.44389 11.25 3.87966 11.25C5.89006 11.25 7.55834 12.7148 7.87539 14.6354L8.25595 13.988L8.25644 13.9872C8.42454 13.7011 8.5925 13.4153 8.76046 13.13C9.01353 12.7054 9.26429 12.2831 9.51402 11.8606L7.46742 8.39878L6.49104 6.73381Z"
          />
          <circle fill="#34A853" cx="3.88008" cy="15.3" r="3.05" />
        </svg>
      );
    case "google_analytics_4":
      return (
        <Frame {...p}>
          <rect x="15" y="3" width="5.5" height="18" rx="2.7" fill="#F9AB00" />
          <rect x="9" y="9" width="5.5" height="12" rx="2.7" fill="#E37400" />
          <circle cx="5.3" cy="18.3" r="2.7" fill="#E37400" />
        </Frame>
      );
    case "youtube":
      return (
        <Frame {...p}>
          <rect x="2" y="5" width="20" height="14" rx="4.5" fill="#FF0000" />
          <path d="M10 9l5.2 3L10 15z" fill="#fff" />
        </Frame>
      );
    case "linkedin":
      return (
        <Frame {...p}>
          <rect x="2.5" y="2.5" width="19" height="19" rx="3.5" fill="#0A66C2" />
          <path d="M7.2 10h2.3v7.3H7.2zM8.3 6.6a1.3 1.3 0 110 2.6 1.3 1.3 0 010-2.6zM11 10h2.2v1c.4-.7 1.2-1.2 2.3-1.2 2.3 0 2.8 1.5 2.8 3.5v4h-2.3v-3.5c0-.9 0-1.9-1.2-1.9s-1.4.9-1.4 1.8v3.6H11z" fill="#fff" />
        </Frame>
      );
    case "tiktok":
    case "tiktok_ads":
      return (
        <Frame {...p}>
          <rect x="2.5" y="2.5" width="19" height="19" rx="5" fill="#000" />
          <path d="M13 6.5v7.2a2.2 2.2 0 11-2-2.2M13 6.5c.3 1.6 1.4 2.6 3 2.7" fill="none" stroke="#25F4EE" strokeWidth="1.7" strokeLinecap="round" transform="translate(-.6 -.4)" />
          <path d="M13 6.5v7.2a2.2 2.2 0 11-2-2.2M13 6.5c.3 1.6 1.4 2.6 3 2.7" fill="none" stroke="#FE2C55" strokeWidth="1.7" strokeLinecap="round" transform="translate(.6 .4)" />
          <path d="M13 6.5v7.2a2.2 2.2 0 11-2-2.2M13 6.5c.3 1.6 1.4 2.6 3 2.7" fill="none" stroke="#fff" strokeWidth="1.7" strokeLinecap="round" />
        </Frame>
      );
    default:
      return (
        <Frame {...p}>
          <circle cx="12" cy="12" r="6" fill="currentColor" opacity="0.35" />
        </Frame>
      );
  }
}
