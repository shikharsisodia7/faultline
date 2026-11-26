import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { ArrowRight, ArrowUpRight } from 'lucide-react'
import { DEMO_SCENARIOS, STOREFRONT, STOREFRONT_CHOICES } from '@faultline/engine'
import { cn } from '@/lib/utils'
import { fullAppHref, IS_STANDALONE, REPO_URL } from '@/lib/target'
import { WhatIfExplorer } from '../story/WhatIfExplorer'
import { HeroRecorder } from './HeroRecorder'
import { MarketingFooter, MarketingNav } from './MarketingChrome'

const cascade = DEMO_SCENARIOS[0]

/** Evidence fragments, all taken from the Checkout Cascade demo incident. */
const FRAGMENTS = [
  { kind: 'Deploy record', text: 'Deploy pricing-svc v2.14.0 (30% of pods)', at: '2:00' },
  { kind: 'Error message', text: 'call to pricing-db timed out after 600 ms', at: '2:35' },
  { kind: 'System alert', text: 'ALERT firing: edge-gateway 10s error rate above the 5.0% SLO', at: '2:36' },
  { kind: 'Failed transaction', text: 'HTTP 504 returned to client: dependency checkout-svc failed: timeout', at: '2:40' },
  { kind: 'Team note', text: cascade.annotations[0].body, at: '2:55' },
]

function useInView<T extends Element>(threshold = 0.35) {
  const ref = useRef<T>(null)
  const [seen, setSeen] = useState(false)
  useEffect(() => {
    const el = ref.current
    if (!el || seen) return
    const io = new IntersectionObserver(([e]) => e.isIntersecting && setSeen(true), { threshold })
    io.observe(el)
    return () => io.disconnect()
  }, [seen, threshold])
  return { ref, seen }
}

function Problem() {
  const { ref, seen } = useInView<HTMLDivElement>()
  return (
    <section className="border-t border-border" aria-labelledby="problem">
      <div className="mx-auto grid max-w-6xl gap-12 px-5 py-24 lg:grid-cols-[0.9fr_1.1fr] lg:items-center">
        <div>
          <p className="fl-eyebrow">The problem</p>
          <h2 id="problem" className="mt-4 text-[34px] font-normal leading-[1.1] text-foreground sm:text-[42px]">A website stops working. Everyone knows something went wrong. Nobody knows where it started.</h2>
          <p className="mt-5 max-w-lg text-[16.5px] leading-relaxed text-muted-foreground">
            The clues are scattered: an error in one place, a release note in another, an alert, a pile of failed payments, a message in the team chat. Faultline puts them in order, on one timeline, so the story becomes visible.
          </p>
        </div>
        <div ref={ref} className="relative">
          <ol className="relative space-y-2.5">
            <span aria-hidden="true" className={cn('absolute left-[54px] top-3 bottom-3 w-px bg-foreground/20 transition-opacity duration-700', seen ? 'opacity-100' : 'opacity-0')} />
            {FRAGMENTS.map((f, i) => (
              <li
                key={f.kind}
                className="relative grid grid-cols-[46px_18px_1fr] items-center gap-3 transition-all duration-700 ease-[var(--ease-out-soft)]"
                style={{ transitionDelay: `${i * 90}ms`, transform: seen ? 'none' : `translate(${(i % 2 ? 1 : -1) * (24 + i * 10)}px, ${(i - 2) * 6}px) rotate(${(i % 2 ? 1.5 : -1.5)}deg)`, opacity: seen ? 1 : 0.55 }}
              >
                <span className="text-right font-mono text-[12px] tabular text-muted-foreground">{f.at}</span>
                <span className="relative z-10 mx-auto size-2.5 rounded-full border-2 border-background" style={{ background: i < 2 ? 'var(--color-degraded)' : i === 4 ? 'var(--color-foreground)' : 'var(--color-fault)' }} />
                <span className="rounded-xl border border-border bg-white px-4 py-3 shadow-[0_1px_2px_rgba(31,29,26,0.05)]">
                  <span className="block text-[12px] text-muted-foreground">{f.kind}</span>
                  <span className="mt-0.5 block text-[14.5px] leading-snug text-foreground">{f.text}</span>
                </span>
              </li>
            ))}
          </ol>
          <p className="mt-4 text-center text-[12.5px] text-muted-foreground">Fragments from the synthetic “Checkout Cascade” demo incident, in the order Faultline reconstructs them.</p>
        </div>
      </div>
    </section>
  )
}

const STEPS = [
  { n: '1', title: 'Replay what happened', body: 'Every log line, deploy, and alert is placed on one timeline. Press play and watch the failure move from one part of the system to the next.', detail: 'Deterministic replay: scrub backward or forward and every view stays in sync.' },
  { n: '2', title: 'Understand why it happened', body: 'Faultline links related events and ranks the places where the trouble likely started, with the evidence for each. Possible causes are labeled as possible, never as proven.', detail: 'Explainable correlation: every link shows the signals behind it.' },
  { n: '3', title: 'Explore what could have changed', body: 'Pick a moment, make a different decision, and run the system forward again. See whether it would have recovered sooner, or made things worse.', detail: 'A seeded simulation of the system, not a guess.' },
]

function StepArt({ step }: { step: number }) {
  return (
    <svg viewBox="0 0 360 200" className="h-auto w-full" aria-hidden="true">
      <rect width="360" height="200" rx="16" fill="#fbfaf7" />
      {step === 0 ? (
        <g>
          {[30, 60, 90, 120, 150].map((y, i) => <line key={y} x1="40" x2="330" y1={y} y2={y} stroke="var(--color-grid)" />)}
          {['website', 'checkout', 'pricing', 'database'].map((n, i) => <text key={n} x="40" y={52 + i * 30} fontSize="10" fill="var(--color-faint)">{n}</text>)}
          {[...Array(26)].map((_, i) => <rect key={i} x={100 + i * 8} y={i > 8 ? 120 : 140} width="5" height={i > 8 ? 10 : 4} rx="1" fill={i > 10 ? 'var(--color-fault)' : 'var(--color-faint)'} opacity={0.8} transform={`translate(0 ${i > 8 ? -((i * 7) % 3) * 30 : 0})`} />)}
          <line x1="230" x2="230" y1="22" y2="170" stroke="var(--color-foreground)" strokeWidth="1.5" />
          <path d="M224 22h12l-6 7z" fill="var(--color-foreground)" />
          <rect x="140" y="172" width="90" height="4" rx="2" fill="var(--color-foreground)" />
          <rect x="40" y="172" width="290" height="4" rx="2" fill="var(--color-grid)" opacity=".8" />
        </g>
      ) : step === 1 ? (
        <g>
          {[['Website', 30, 80], ['Checkout', 130, 80], ['Pricing', 230, 40], ['Database', 230, 120]].map(([n, x, y]) => (
            <g key={n as string}>
              <rect x={x as number} y={y as number} width="90" height="40" rx="10" fill="#fff" stroke={n === 'Database' ? 'var(--color-fault)' : 'rgba(31,29,26,.15)'} strokeWidth={n === 'Database' ? 1.6 : 1} />
              <text x={(x as number) + 14} y={(y as number) + 25} fontSize="12" fill="var(--color-foreground)">{n}</text>
            </g>
          ))}
          <path d="M120 100h10M220 100c5 0 5-40 10-40M220 100c5 0 5 40 10 40" fill="none" stroke="rgba(31,29,26,.35)" />
          <rect x="225" y="115" width="100" height="50" rx="13" fill="none" stroke="var(--color-fault)" strokeDasharray="4 4" />
          <text x="230" y="182" fontSize="10.5" fill="var(--color-fault)">likely starting point</text>
          <text x="30" y="160" fontSize="10.5" fill="var(--color-muted-foreground)">same request · slowed first · its callers failed next</text>
        </g>
      ) : (
        <g>
          <line x1="30" x2="330" y1="70" y2="70" stroke="var(--color-border)" strokeWidth="3" />
          <path d="M30 70H150" stroke="var(--color-foreground)" strokeWidth="3" />
          <path d="M150 70H330" stroke="var(--color-fault)" strokeWidth="3" />
          <path d="M150 70c30 0 18 70 52 70h128" fill="none" stroke="var(--color-sim)" strokeWidth="3" />
          <path d="M150 70L200 40L240 30L280 38L330 44V70H150Z" fill="var(--color-fault)" opacity=".12" />
          <circle cx="150" cy="70" r="7" fill="var(--color-foreground)" stroke="#fbfaf7" strokeWidth="3" />
          <text x="230" y="60" fontSize="10.5" fill="var(--color-fault)">what happened</text>
          <text x="230" y="160" fontSize="10.5" fill="var(--color-sim)">what could have</text>
          <text x="120" y="100" fontSize="10.5" fill="var(--color-muted-foreground)">decision</text>
        </g>
      )}
    </svg>
  )
}

function HowItWorks() {
  const [active, setActive] = useState(0)
  return (
    <section id="how" className="scroll-mt-20 border-t border-border bg-card/60" aria-labelledby="how-title">
      <div className="mx-auto max-w-6xl px-5 py-24">
        <p className="fl-eyebrow">How it works</p>
        <h2 id="how-title" className="mt-4 max-w-2xl text-[34px] font-normal leading-[1.1] text-foreground sm:text-[42px]">Three questions, answered in order.</h2>
        <div className="mt-12 grid gap-10 lg:grid-cols-[0.9fr_1.1fr] lg:items-center">
          <ol className="space-y-1" role="tablist" aria-label="How Faultline works">
            {STEPS.map((s, i) => (
              <li key={s.n}>
                <button
                  type="button"
                  role="tab"
                  aria-selected={active === i}
                  onClick={() => setActive(i)}
                  onMouseEnter={() => setActive(i)}
                  className={cn('block w-full border-l-2 py-4 pl-5 pr-2 text-left transition-colors', active === i ? 'border-foreground' : 'border-border hover:border-foreground/40')}
                >
                  <span className={cn('block text-[19px] transition-colors', active === i ? 'text-foreground' : 'text-muted-foreground')}>{s.title}</span>
                  {active === i ? (
                    <>
                      <span className="mt-2 block text-[15px] leading-relaxed text-muted-foreground">{s.body}</span>
                      <span className="mt-2 block font-mono text-[12px] text-faint">{s.detail}</span>
                    </>
                  ) : null}
                </button>
              </li>
            ))}
          </ol>
          <div className="fl-frame" role="tabpanel" aria-label={STEPS[active].title}>
            <div className="fl-frame-inner"><StepArt step={active} /></div>
          </div>
        </div>
      </div>
    </section>
  )
}

const USES = [
  { who: 'Software engineers', what: 'See the exact order in which services failed, inspect the raw evidence behind every link, and test a fix in simulation before arguing about it.' },
  { who: 'Founders', what: 'Understand why the product stopped working, in plain words, without reading a single log file.' },
  { who: 'Product managers', what: 'See how many customers were affected and for how long, and which decision would have shortened it.' },
  { who: 'Students', what: 'Watch how real systems fail: queues fill, retries pile up, and one slow part brings down everything that depends on it.' },
  { who: 'Engineering teams', what: 'Share one timeline, annotate it together, compare recovery strategies, and turn the investigation into an incident report.' },
]

function UseCases() {
  const [i, setI] = useState(0)
  return (
    <section id="use-cases" className="scroll-mt-20 border-t border-border" aria-labelledby="uses">
      <div className="mx-auto max-w-6xl px-5 py-24">
        <p className="fl-eyebrow">Use cases</p>
        <h2 id="uses" className="mt-4 max-w-2xl text-[34px] font-normal leading-[1.1] text-foreground sm:text-[42px]">Built for whoever has to explain the outage.</h2>
        <div className="mt-10 grid gap-8 md:grid-cols-[260px_1fr]">
          <div className="flex gap-1 overflow-x-auto md:flex-col" role="tablist" aria-label="Who uses Faultline">
            {USES.map((u, k) => (
              <button key={u.who} type="button" role="tab" aria-selected={i === k} onClick={() => setI(k)} className={cn('shrink-0 rounded-lg px-3 py-2.5 text-left text-[15px] transition-colors', i === k ? 'bg-white text-foreground shadow-[0_0_0_1px_rgba(31,29,26,0.08)]' : 'text-muted-foreground hover:text-foreground')}>
                {u.who}
              </button>
            ))}
          </div>
          <div role="tabpanel" className="rounded-2xl border border-border bg-white p-7 sm:p-9">
            <p className="text-[24px] font-normal leading-snug text-foreground sm:text-[28px]">{USES[i].what}</p>
            <Link to={i === 0 ? '/demo/checkout-cascade?mode=engineering' : i === 3 ? '/lab' : '/demo/checkout-cascade'} className="mt-6 inline-flex items-center gap-1.5 text-[14.5px] font-medium text-[var(--color-primary)] hover:underline">
              {i === 0 ? 'Open the engineering view' : i === 3 ? 'Open the experiment lab' : 'Walk through the demo'} <ArrowRight className="size-4" />
            </Link>
          </div>
        </div>
      </div>
    </section>
  )
}

const TECH = [
  { t: 'Deterministic event replay', d: 'Immutable, ordered evidence; checkpointed state reconstruction proven equal to a full replay.', doc: '/docs/replay' },
  { t: 'Explainable correlation', d: 'Indexed candidate search and noisy-OR evidence scoring. No language model in the loop; every score is explained.', doc: '/docs/correlation' },
  { t: 'Dependency-aware simulation', d: 'Seeded discrete-event model with queues, timeouts, retries, breakers, and rate limits.', doc: '/docs/simulation' },
  { t: 'Secure evidence storage', d: 'Private per-user file storage, workspace isolation on every record, writes only through authorized server actions.', doc: '/docs/data-model' },
  { t: 'Real-time collaboration', d: 'Notes, reviews, bookmarks, and presence sync live through DeepSpace records.', doc: '/docs/architecture' },
  { t: 'Background processing', d: 'Durable import jobs with recorded progress, cooperative cancellation, and idempotent retries.', doc: '/docs/architecture' },
]

function Engineered() {
  return (
    <section className="border-t border-border bg-[#1f1d1a] text-[#f5f3ef]" aria-labelledby="eng">
      <div className="mx-auto max-w-6xl px-5 py-24">
        <p className="font-mono text-[11.5px] uppercase tracking-[0.14em] text-[#b5ada2]">For engineers and reviewers</p>
        <h2 id="eng" className="mt-4 max-w-2xl text-[34px] font-normal leading-[1.1] sm:text-[42px]">Simple on the surface. Engineered underneath.</h2>
        <dl className="mt-12 grid gap-px overflow-hidden rounded-2xl bg-white/10 sm:grid-cols-2 lg:grid-cols-3">
          {TECH.map((x) => (
            <div key={x.t} className="bg-[#1f1d1a] p-6">
              <dt className="text-[16px] font-medium">{x.t}</dt>
              <dd className="mt-2 text-[14px] leading-relaxed text-[#c9c2b8]">{x.d}</dd>
              <Link to={x.doc} className="mt-4 inline-flex items-center gap-1 text-[13px] text-[#f0a48f] hover:underline">How it works <ArrowUpRight className="size-3.5" /></Link>
            </div>
          ))}
        </dl>
        <div className="mt-8 flex flex-wrap gap-3">
          <a href={REPO_URL} className="inline-flex h-10 items-center gap-1.5 rounded-lg bg-[#f5f3ef] px-4 text-[14px] font-medium text-[#1f1d1a] hover:bg-white">Read the source <ArrowUpRight className="size-4" /></a>
          <Link to="/docs" className="inline-flex h-10 items-center rounded-lg px-4 text-[14px] text-[#f5f3ef] ring-1 ring-white/20 hover:bg-white/5">Technical documentation</Link>
        </div>
      </div>
    </section>
  )
}

export function Landing() {
  return (
    <div className="min-h-screen bg-background">
      <MarketingNav />
      <main>
        <section className="relative overflow-hidden">
          <div className="fl-grid-bg pointer-events-none absolute inset-x-0 top-0 h-[560px] [mask-image:linear-gradient(to_bottom,black,transparent)]" aria-hidden="true" />
          <div className="relative mx-auto max-w-6xl px-5 pb-20 pt-16 sm:pt-24">
            <div className="mx-auto max-w-3xl text-center fl-rise">
              <p className="fl-eyebrow">The flight recorder for software</p>
              <h1 className="mt-5 text-[40px] font-normal leading-[1.04] tracking-[-0.035em] text-foreground sm:text-[60px]">
                Understand what broke.<br className="hidden sm:block" /> <span className="text-muted-foreground">Discover what could have gone differently.</span>
              </h1>
              <p className="mx-auto mt-6 max-w-2xl text-[17px] leading-relaxed text-muted-foreground">
                Faultline turns confusing software failures into visual stories. Replay what happened, see where it likely started, and explore how a different decision could have changed the outcome.
              </p>
              <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
                <Link to="/demo/checkout-cascade" className="fl-cta inline-flex h-11 items-center gap-2 rounded-xl px-5 text-[15px] font-medium">Explore live demo <ArrowRight className="size-4" /></Link>
                <a href="#how" className="fl-btn-quiet inline-flex h-11 items-center rounded-xl px-5 text-[15px]">See how it works</a>
              </div>
              <p className="mt-4 text-[13px] text-muted-foreground">No account needed.</p>
            </div>
            <div className="mx-auto mt-14 max-w-5xl fl-rise" style={{ animationDelay: '120ms' }}>
              <HeroRecorder />
            </div>
          </div>
        </section>

        <Problem />
        <HowItWorks />

        <section id="what-if" className="scroll-mt-20 border-t border-border" aria-labelledby="whatif">
          <div className="mx-auto max-w-6xl px-5 py-24">
            <p className="fl-eyebrow">What if?</p>
            <h2 id="whatif" className="mt-4 max-w-3xl text-[34px] font-normal leading-[1.1] text-foreground sm:text-[48px]">What if you could go back and make a different decision?</h2>
            <p className="mt-5 max-w-2xl text-[16.5px] leading-relaxed text-muted-foreground">
              The same online store, the same flash sale. Choose what you would have done and when. Faultline runs the system forward again and draws the alternative right next to what actually happened.
            </p>
            <div className="mt-12">
              <WhatIfExplorer
                scenario={STOREFRONT}
                choices={STOREFRONT_CHOICES}
                defaultDecisionSec={70}
                markers={[{ atSec: 60, label: 'Flash sale starts', kind: 'change' }, { atSec: 170, label: 'Sale ends', kind: 'response' }]}
                actions={<Link to="/demo/checkout-cascade" className="fl-btn-quiet inline-flex h-9 items-center gap-1.5 rounded-lg px-3 text-[13.5px]">Try it on a full incident <ArrowRight className="size-4" /></Link>}
              />
            </div>
          </div>
        </section>

        <UseCases />
        <Engineered />

        <section className="relative overflow-hidden border-t border-border" aria-labelledby="cta">
          <div className="fl-grid-bg pointer-events-none absolute inset-0 [mask-image:radial-gradient(ellipse_at_center,black,transparent_70%)]" aria-hidden="true" />
          <div className="relative mx-auto max-w-4xl px-5 py-28 text-center">
            <svg viewBox="0 0 320 60" className="mx-auto mb-8 h-12 w-auto" aria-hidden="true">
              <path d="M10 30H120" stroke="var(--color-foreground)" strokeWidth="3" strokeLinecap="round" />
              <path d="M120 30l14-24 16 46 12-34 10 12h138" fill="none" stroke="var(--color-fault)" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
              <path d="M120 30c40 0 40 24 90 24h100" fill="none" stroke="var(--color-sim)" strokeWidth="3" strokeLinecap="round" />
              <circle cx="120" cy="30" r="7" fill="var(--color-foreground)" stroke="var(--color-background)" strokeWidth="3" />
            </svg>
            <h2 id="cta" className="text-[36px] font-normal leading-[1.08] text-foreground sm:text-[52px]">Every failure has a story.<br />Explore yours.</h2>
            <div className="mt-9 flex flex-wrap justify-center gap-3">
              <Link to="/demo" className="fl-cta inline-flex h-11 items-center gap-2 rounded-xl px-5 text-[15px] font-medium">Try Faultline <ArrowRight className="size-4" /></Link>
              <a href={REPO_URL} className="fl-btn-quiet inline-flex h-11 items-center rounded-xl px-5 text-[15px]">Explore the source code</a>
            </div>
            {IS_STANDALONE ? (
              <p className="mx-auto mt-8 max-w-xl text-[13px] text-muted-foreground">
                You are on the standalone demo. Sign-in, private uploads, and live collaboration are in the {fullAppHref() ? <a href={fullAppHref()!} className="underline underline-offset-2">full app on DeepSpace</a> : 'full app on DeepSpace'}.
              </p>
            ) : null}
          </div>
        </section>
      </main>
      <MarketingFooter />
    </div>
  )
}
