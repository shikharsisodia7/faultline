/** Public pages share the marketing navigation. Kept as a module for existing imports. */
import { MarketingNav } from '../landing/MarketingChrome'

export function SiteHeader(_props: { compact?: boolean; extra?: React.ReactNode }) {
  return <MarketingNav />
}
