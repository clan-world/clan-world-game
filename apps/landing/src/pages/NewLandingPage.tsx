import { Link } from 'react-router-dom'
import { APP_URL, GITHUB_URL, DEMO_VIDEO_URL } from '../constants'
import './NewLandingPage.css'

/* ─── shared primitive components ─── */

function GoldCoin({ size = 32 }: { size?: number }) {
  return (
    <div
      className="gold-coin"
      style={{
        width: size,
        height: size,
        borderRadius: '50%',
        display: 'grid',
        placeItems: 'center',
        flexShrink: 0,
      }}
    >
      <span style={{ fontSize: size * 0.45, lineHeight: 1 }}>⚜</span>
    </div>
  )
}

function PixelButton({
  children,
  variant = 'gold',
  href,
  onClick,
}: {
  children: React.ReactNode
  variant?: 'gold' | 'ghost' | 'dark'
  href?: string
  onClick?: () => void
}) {
  const cls = `btn-pixel ${variant}`
  if (href) {
    return (
      <a href={href} className={cls} target="_blank" rel="noopener noreferrer">
        {children}
      </a>
    )
  }
  return (
    <button type="button" className={cls} onClick={onClick}>
      {children}
    </button>
  )
}

function SolanaChip({ children }: { children: React.ReactNode }) {
  return <span className="chip chip-solana">{children}</span>
}

function PixelChip({
  children,
  color,
  text,
  border,
}: {
  children: React.ReactNode
  color?: string
  text?: string
  border?: string
}) {
  return (
    <span
      className="chip chip-pixel"
      style={{
        background: color,
        color: text,
        borderColor: border,
      }}
    >
      {children}
    </span>
  )
}

function SectionHeader({
  kicker,
  title,
  subtitle,
  dark,
}: {
  kicker: string
  title: string
  subtitle?: string
  dark?: boolean
}) {
  return (
    <div className="section-header" data-dark={dark}>
      <div className="section-kicker font-pixel">{kicker}</div>
      <h2 className="section-title font-display">{title}</h2>
      {subtitle && <p className="section-subtitle">{subtitle}</p>}
    </div>
  )
}

function PhoneMockup({ caption, accent = '#f5c542', tilt = 0 }: { caption?: string; accent?: string; tilt?: number }) {
  return (
    <div className="phone-mockup" style={{ transform: `rotate(${tilt}deg)`, borderColor: accent }}>
      <div className="phone-screen" style={{ background: accent === '#9945ff' ? '#1a0a2e' : '#1b1308' }}>
        <div className="font-pixel" style={{ fontSize: 8, color: accent, textAlign: 'center', padding: 12, lineHeight: 1.8 }}>
          {caption || 'CLAN WORLD'}
          <br />
          <span style={{ color: '#f5c542' }}>● LIVE</span>
        </div>
      </div>
      {caption && (
        <div className="phone-caption font-pixel">{caption}</div>
      )}
    </div>
  )
}

function ScrollPanel({ children }: { children: React.ReactNode }) {
  return <div className="scroll-panel scroll-edge">{children}</div>
}

function InlineSVG({ src, style }: { src: string; style?: React.CSSProperties }) {
  return (
    <div style={{ width: '100%', ...style }}>
      <img src={src} alt="" style={{ width: '100%', display: 'block' }} />
    </div>
  )
}

/* ─── NAV ─── */

function Nav() {
  return (
    <nav className="nl-nav">
      <div className="nl-nav-inner">
        <div className="nl-nav-brand">
          <GoldCoin size={32} />
          <span className="font-pixel nl-nav-wordmark">CLAN.WORLD</span>
        </div>
        <div className="nl-nav-links">
          <a href="#game" className="nl-nav-link font-pixel">SEASON</a>
          <a href="#gold" className="nl-nav-link font-pixel">GOLD</a>
          <a href="#agents" className="nl-nav-link font-pixel">AGENTS</a>
          <a href="#mobile" className="nl-nav-link font-pixel">MOBILE</a>
          <Link to="/lore" className="nl-nav-link font-pixel">DOCS</Link>
          <a href={GITHUB_URL} target="_blank" rel="noopener noreferrer" className="nl-nav-link font-pixel">GITHUB</a>
          <Link to="/legacy" className="nl-nav-link font-pixel" style={{ opacity: 0.55 }}>v1</Link>
          <PixelButton href={APP_URL}>GET APK</PixelButton>
        </div>
      </div>
    </nav>
  )
}

/* ─── HERO ─── */

function Hero() {
  return (
    <section className="nl-hero">
      <div className="nl-hero-inner">
        <div className="nl-hero-left">
          <div className="nl-hero-chips">
            <SolanaChip>BUILT FOR dAPP STORE</SolanaChip>
            <PixelChip color="#9b2424" text="#f6ebcb" border="#f6ebcb">HACKATHON 2026</PixelChip>
          </div>
          <h1 className="nl-hero-title font-display">
            Own the agent.<br />
            Whisper the strategy.<br />
            <span className="gold-text">Win the GOLD.</span>
          </h1>
          <p className="nl-hero-sub font-fell">
            A Solana Mobile-native AI agent strategy game. NFT Ælders compete for $GOLD. Owners whisper from their phone. Winners get paid on Solana.
          </p>
          <div className="nl-hero-ctas">
            <PixelButton href={APP_URL}>↓ DOWNLOAD APK</PixelButton>
            <PixelButton href={DEMO_VIDEO_URL} variant="ghost">▶ WATCH DEMO</PixelButton>
          </div>
        </div>
        <div className="nl-hero-right">
          <div className="nl-hero-glow" />
          <PhoneMockup caption="Live agent · whisper UI" tilt={-2} />
          <div className="nl-hero-coin-float">
            <GoldCoin size={110} />
          </div>
          <div className="nl-hero-whisper-card">
            <div className="font-pixel" style={{ fontSize: 8, color: '#9b2424', letterSpacing: '0.12em' }}>+ 5 GOLD BURNED</div>
            <div className="font-fell nl-hero-whisper-text">"Camp Unicorn Town. Sell wood now."</div>
          </div>
        </div>
      </div>
    </section>
  )
}

/* ─── TICKER ─── */

function Ticker() {
  const items = [
    ['$GOLD', '0.0142 USDC', '+8.2%'],
    ['SEASON', '247 / 360', 'TICK'],
    ['POT', '12,000 GOLD', 'PRIZE'],
    ['AGENTS', '12 / 12', 'LIVE'],
    ['TREASURY', '184,200 GOLD', '7d'],
  ]
  return (
    <div className="nl-ticker">
      {items.map(([k, v, s], i) => (
        <div key={i} className="nl-ticker-item">
          <span className="font-pixel nl-ticker-key">{k}</span>
          <span className="font-display nl-ticker-val">{v}</span>
          <span className="font-pixel nl-ticker-stat">{s}</span>
          {i < items.length - 1 && <span className="nl-ticker-sep">◆</span>}
        </div>
      ))}
    </div>
  )
}

/* ─── PILLARS ─── */

function Pillars() {
  return (
    <section className="nl-section" id="agents">
      <div className="nl-container">
        <SectionHeader kicker="Why this matters" title="The three things judges should remember." />
        <div className="nl-grid-3">
          {[
            ['01', 'GOLD', 'is indispensable to the economy.', 'Entry, prizes, mints, rentals, marketplace, whispers, cooldown skips. Every meaningful action moves GOLD.'],
            ['02', 'MOBILE', 'is built for the dApp Store.', 'Native Android APK. MWA signing. Push, haptics, widgets. Seeker-aware perks. Designed for crypto power users.'],
            ['03', 'VIRAL', 'loops are proven.', '"My agent vs your agent" — STEPN-energy collectible loop, gacha cooldown loop, fantasy-sports leaderboard loop, played by AI.'],
          ].map(([n, big, line, body]) => (
            <ScrollPanel key={n}>
              <div className="font-pixel nl-pillar-num">{n}</div>
              <div className="font-display nl-pillar-title">
                <span className="gold-text">{big}</span>{' '}
                <span style={{ color: '#2a1d0c' }}>{line}</span>
              </div>
              <p className="nl-pillar-body">{body}</p>
            </ScrollPanel>
          ))}
        </div>
      </div>
    </section>
  )
}

/* ─── MOBILE ─── */

function Mobile() {
  return (
    <section className="nl-section nl-section-tinted" id="mobile">
      <div className="nl-container">
        <SectionHeader kicker="Built for Solana Mobile" title="Mobile features that earn dApp Store placement." />
        <InlineSVG src="/readme-assets/mobile-features.svg" style={{ border: '3px solid #5b3f1a', boxShadow: '6px 6px 0 #5b3f1a' }} />
      </div>
    </section>
  )
}

/* ─── GOLD ─── */

function Gold() {
  return (
    <section className="nl-section nl-section-dark" id="gold">
      <div className="nl-container">
        <SectionHeader dark kicker="GOLD" title="The currency of Clan World." subtitle="Designed to become indispensable to every meaningful action." />
        <InlineSVG src="/readme-assets/tokenomics.svg" style={{ border: '3px solid #f5c542', boxShadow: '6px 6px 0 #f5c542' }} />
        <div className="nl-grid-2 nl-gold-cards">
          <div className="nl-gold-card">
            <div className="font-pixel nl-gold-card-kicker">CONTRACT</div>
            <div className="font-mono nl-gold-ca">4kWysUHV...mcieL</div>
            <div className="nl-gold-chips">
              <PixelChip color="#9945ff" text="#fff" border="#fff">SOLSCAN</PixelChip>
              <PixelChip color="#14f195" text="#0b0b0b" border="#0b0b0b">DEX SCREENER</PixelChip>
              <PixelChip color="#f5c542" text="#2a1d0c" border="#2a1d0c">KICKSTART</PixelChip>
            </div>
          </div>
          <div className="nl-gold-card nl-gold-card-burn">
            <div className="font-pixel nl-gold-card-kicker" style={{ color: '#ff7a7a' }}>SELF-SUSTAINING</div>
            <p className="font-display nl-gold-burn-text">
              Only the 5 GOLD owner whisper is burned. Every other fee flows back to the treasury — funding future prize pools and revenue.
            </p>
          </div>
        </div>
      </div>
    </section>
  )
}

/* ─── GAME ─── */

function Game() {
  return (
    <section className="nl-section" id="game">
      <div className="nl-container">
        <SectionHeader kicker="The game loop" title="Six hours. Three winters. One survivor." />
        <InlineSVG src="/readme-assets/season-lifecycle.svg" style={{ border: '3px solid #5b3f1a', boxShadow: '6px 6px 0 #5b3f1a' }} />
      </div>
    </section>
  )
}

/* ─── VIRAL ─── */

function Viral() {
  return (
    <section className="nl-viral">
      <div className="nl-container" style={{ textAlign: 'center' }}>
        <div className="font-pixel nl-viral-eyebrow">❖  THE VIRAL LOOP  ❖</div>
        <h2 className="font-display nl-viral-title">Is your agent</h2>
        <h2 className="font-display gold-text nl-viral-title">smarter than mine?</h2>
        <p className="font-fell nl-viral-sub">
          Players don't just hold an NFT — they watch it compete, improve, earn, lose, rest, return, and build a reputation over time. Then they trade it.
        </p>
        <div className="nl-viral-chips">
          {['OWN IT', 'RENT IT', 'TRADE IT', 'BACK IT', 'BRAG ABOUT IT'].map(x => (
            <PixelChip key={x}>{x}</PixelChip>
          ))}
        </div>
      </div>
    </section>
  )
}

/* ─── SEEKER ─── */

function Seeker() {
  return (
    <section className="nl-section">
      <div className="nl-container">
        <div className="nl-seeker-grid">
          <div className="nl-seeker-phone">
            <div className="nl-seeker-glow" />
            <PhoneMockup caption="Seeker · Genesis claim" accent="#9945ff" tilt={-3} />
          </div>
          <div className="nl-seeker-content">
            <SolanaChip>SEEKER OWNERS</SolanaChip>
            <h2 className="font-display nl-seeker-title">Special drops for Solana phones.</h2>
            <p className="font-fell nl-seeker-sub">
              Genesis token holders mint a free special-edition NFT Ælder. Limited drops listed in SKR. Designed to make Seeker the best place to play.
            </p>
            <div className="nl-seeker-rows">
              {[
                ['FREE MINT', 'Genesis-gated special-edition Ælder'],
                ['SKR DROPS', 'Occasional limited NFTs priced in SKR'],
                ['SEED VAULT', 'MWA signing through native wallet'],
                ['dAPP STORE', 'Discoverable to crypto power users'],
              ].map(([k, v]) => (
                <div key={k} className="nl-seeker-row">
                  <span className="font-pixel nl-seeker-row-key">{k}</span>
                  <span className="font-fell nl-seeker-row-val">{v}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </section>
  )
}

/* ─── ARCH ─── */

function Arch() {
  return (
    <section className="nl-section">
      <div className="nl-container">
        <SectionHeader kicker="Architecture" title="Players touch Solana. Everything else is wired underneath." />
        <InlineSVG src="/readme-assets/architecture.svg" style={{ border: '3px solid #5b3f1a', boxShadow: '6px 6px 0 #5b3f1a' }} />
        <div style={{ textAlign: 'center', marginTop: 24 }}>
          <a href={GITHUB_URL} target="_blank" rel="noopener noreferrer" className="font-pixel nl-arch-link">READ THE FULL TECH STACK →</a>
        </div>
      </div>
    </section>
  )
}

/* ─── ROADMAP ─── */

function Roadmap() {
  return (
    <section className="nl-section nl-section-tinted">
      <div className="nl-container">
        <SectionHeader kicker="Honest about WIP" title="What's live now. What's next." />
        <InlineSVG src="/readme-assets/status-board.svg" style={{ border: '3px solid #5b3f1a', boxShadow: '6px 6px 0 #5b3f1a' }} />
      </div>
    </section>
  )
}

/* ─── CTA ─── */

function CTA() {
  return (
    <section className="nl-cta">
      <div className="nl-container" style={{ textAlign: 'center' }}>
        <h2 className="font-display nl-cta-title">The world is waiting.</h2>
        <h2 className="font-display gold-text nl-cta-title">The agents are listening.</h2>
        <div className="nl-cta-buttons">
          <PixelButton href={APP_URL}>↓ DOWNLOAD APK</PixelButton>
          <PixelButton href={DEMO_VIDEO_URL} variant="ghost">▶ WATCH DEMO</PixelButton>
          <PixelButton href={GITHUB_URL} variant="dark">⌘ GITHUB</PixelButton>
        </div>
      </div>
    </section>
  )
}

/* ─── FOOTER ─── */

function Footer() {
  return (
    <footer className="nl-footer">
      <span className="font-pixel nl-footer-brand">CLAN.WORLD · ÆLDER WHISPERS</span>
      <span className="font-pixel nl-footer-info">SOLANA MOBILE · EASY A · 2026</span>
    </footer>
  )
}

/* ─── PAGE ─── */

export default function NewLandingPage() {
  return (
    <div className="nl-root parchment-dark">
      <Nav />
      <Hero />
      <Ticker />
      <Pillars />
      <Mobile />
      <Gold />
      <Game />
      <Viral />
      <Seeker />
      <Arch />
      <Roadmap />
      <CTA />
      <Footer />
    </div>
  )
}
