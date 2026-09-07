"use client";

import { ThemeToggle } from "@/components/ui/theme-toggle";

import Link from "next/link";
import { useEffect, useState } from "react";
import { ArrowUpRight, Ban, CircleCheck, Diamond as DiamondIcon, ShieldAlert, UserRound, Wallet } from "lucide-react";
import { GlassCard, GlassPanel, GlassSurface, TicketSection, TicketSurface } from "@/components/ui/surface";
import { Button, IconButton } from "@/components/ui/button";
import { Input, OtpPreview, PasswordInput } from "@/components/ui/input";
import { Tabs } from "@/components/ui/tabs";
import { Alert, Badge, CardSkeleton, EmptyState, ErrorState, Skeleton, type Tone } from "@/components/ui/feedback";
import { Money } from "@/components/ui/money";
import { Countdown } from "@/components/ui/countdown";
import { NumberTile } from "@/components/ui/number-tile";
import { BottomSheet, ConfirmationDialog, Drawer, Modal } from "@/components/ui/overlay";
import { DataTable, type DataColumn } from "@/components/ui/data-table";
import { ProfileMenu } from "@/components/shared/navigation";
import { useToast } from "@/components/ui/toast";

const tones: Tone[] = ["neutral", "info", "success", "warning", "danger"];
const swatches = [
  { label: "Background", value: "var(--background)" },
  { label: "Surface", value: "var(--surface)" },
  { label: "Surface elevated", value: "var(--surface-elevated)" },
  { label: "Glass strong", value: "var(--glass-strong)" },
  { label: "Accent", value: "var(--accent)" },
  { label: "Success", value: "var(--success)" },
];

type ActivityRow = { id: string; market: string; detail: string; amount: number; tone: Tone };
const activity: ActivityRow[] = [
  { id: "a1", market: "Diamond Morning", detail: "Jodi · 2 selections", amount: 50000, tone: "info" },
  { id: "a2", market: "Diamond Evening", detail: "Result declared", amount: 480000, tone: "success" },
  { id: "a3", market: "Diamond Night", detail: "Edit window closed", amount: 20000, tone: "warning" },
];
const activityColumns: DataColumn<ActivityRow>[] = [
  { key: "market", label: "Market", render: (row) => row.market },
  { key: "detail", label: "Detail", render: (row) => row.detail },
  { key: "amount", label: "Amount", render: (row) => <Money paise={row.amount} /> },
  { key: "status", label: "Status", render: (row) => <Badge tone={row.tone}>{row.tone}</Badge> },
];

/** Countdown reads Date.now() only after mount; these demo instants follow the same pattern to stay a pure render. */
function useDemoInstants() {
  const [instants, setInstants] = useState<{ ticketEdit: Date; editWindow: Date; closingSoon: Date } | null>(null);
  useEffect(() => {
    const timer = setTimeout(() => {
      const base = Date.now();
      setInstants({ ticketEdit: new Date(base + 47 * 60 * 1000), editWindow: new Date(base + 90 * 60 * 1000), closingSoon: new Date(base + 4 * 60 * 1000) });
    }, 0);
    return () => clearTimeout(timer);
  }, []);
  return instants;
}

export function DesignShowcase() {
  const toast = useToast();
  const [selectedTile, setSelectedTile] = useState("07");
  const demoInstants = useDemoInstants();
  const invalidInstant = new Date(NaN);
  const notify = (title: string) => toast({ title, description: "Design studio demonstration only. No account action was performed." });

  return (
    <div className="app-container studio">
      <header className="studio-header">
        <div>
          <p className="eyebrow">Development only · not linked from production navigation</p>
          <h1 className="type-page-title">Design studio</h1>
        </div>
        <ThemeToggle /><nav className="studio-links" aria-label="Shell previews">
          <Link className="text-link" href="/dev/player/home">Player shell <ArrowUpRight aria-hidden="true" /></Link>
          <Link className="text-link" href="/dev/admin/dashboard">Admin shell <ArrowUpRight aria-hidden="true" /></Link>
          <Link className="text-link" href="/login">Player login <ArrowUpRight aria-hidden="true" /></Link>
          <Link className="text-link" href="/admin/login">Admin login <ArrowUpRight aria-hidden="true" /></Link>
        </nav>
      </header>

      <section className="studio-section" aria-labelledby="themes-heading">
        <div className="studio-section-heading"><h2 id="themes-heading" className="type-section-title">Light first. Dark by choice.</h2><p>Use the header control to inspect the full page in either theme.</p></div>
        <div className="theme-comparison">{(["light", "dark"] as const).map(theme => <div key={theme} data-theme={theme} className="theme-specimen">
          <p className="eyebrow">{theme === "light" ? "Light · default" : "Dark · optional"}</p>
          <GlassCard className="stack"><div className="between"><h3 className="type-card-title">Material specimen</h3><Badge tone="success">Open</Badge></div><div className="between"><span className="result-value">07</span><Money paise={125000} size="medium" /></div><Input label={theme + " input specimen"} placeholder="Enter an amount" /><div className="row"><Button onClick={() => notify("Play specimen")}>Play specimen</Button><Badge tone="warning">Closing soon</Badge></div><Alert tone="danger" title="Error specimen">Clear feedback in either theme.</Alert></GlassCard>
        </div>)}</div>
      </section>
      <section className="studio-hero">
        <div className="studio-hero-copy">
          <Badge tone="info">Premium design system</Badge>
          <p className="eyebrow">Apple-inspired polish · fintech clarity</p>
          <h2 className="type-display">Every surface,<br /><span className="text-accent">one considered system.</span></h2>
          <p className="text-secondary type-body">Tokens, glass, motion and the signature ticket, gathered in one place for inspection. Nothing on this page performs a real account, market or financial action.</p>
        </div>
        <div>
          <TicketSurface>
            <TicketSection>
              <p className="ticket-title text-muted">Diamond · Sample Ticket</p>
              <div className="ticket-lines">
                <div><span className="text-secondary">Market</span><span>Diamond Evening</span></div>
                <div><span className="text-secondary">Entry</span><span>Jodi</span></div>
              </div>
            </TicketSection>
            <TicketSection>
              <div className="ticket-lines">
                <div><span className="text-secondary">Selections</span><span>04, 27</span></div>
                <div><span className="text-secondary">Stake each</span><span><Money paise={5000} /></span></div>
                <div><span className="text-secondary">Payout rate</span><span>1 : 90</span></div>
              </div>
            </TicketSection>
            <TicketSection>
              <div className="ticket-lines">
                <div><span className="text-secondary">Total amount</span><span className="numeric-medium"><Money paise={10000} /></span></div>
                <div><span className="text-secondary">Edit until</span><Countdown compact target={demoInstants?.ticketEdit ?? invalidInstant} /></div>
              </div>
            </TicketSection>
          </TicketSurface>
          <p className="studio-ticket-note">Sample data for visual demonstration only · not a placed bet</p>
        </div>
      </section>

      <section className="studio-section">
        <div className="studio-section-heading"><h3 className="type-section-title">Color &amp; surface</h3><p>Deep charcoal base, restrained accent, layered glass.</p></div>
        <div className="swatches">
          {swatches.map((swatch) => (
            <div key={swatch.label}>
              <div className="swatch" style={{ background: swatch.value }} />
              <p className="specimen-label">{swatch.label}</p>
            </div>
          ))}
        </div>
        <div className="surface-specimens">
          <GlassSurface variant="subtle" className="glass-card"><p className="type-label">Subtle</p><p className="text-secondary type-body-small">Background texture, lowest emphasis.</p></GlassSurface>
          <GlassCard><p className="type-label">Default</p><p className="text-secondary type-body-small">Standard card surface.</p></GlassCard>
          <GlassCard variant="strong"><p className="type-label">Strong</p><p className="text-secondary type-body-small">Overlays and elevated panels.</p></GlassCard>
        </div>
      </section>

      <section className="studio-section">
        <div className="studio-section-heading"><h3 className="type-section-title">Typography</h3><p>Geist Sans with tabular numerics for financial content.</p></div>
        <div className="stack">
          <p className="type-display">Display heading</p>
          <p className="type-page-title">Page title</p>
          <p className="type-section-title">Section title</p>
          <p className="type-card-title">Card title</p>
          <p className="type-body">Body copy sits at a comfortable reading size with generous line height.</p>
          <p className="type-label">Label text</p>
          <p className="type-caption text-muted">Caption / metadata text</p>
          <p className="numeric-large"><Money paise={1284500} /></p>
        </div>
      </section>

      <section className="studio-section">
        <div className="studio-section-heading"><h3 className="type-section-title">Buttons</h3><p>Press feedback and loading states share one spring.</p></div>
        <div className="row">
          <Button onClick={() => notify("Primary action")}>Primary</Button>
          <Button variant="secondary" onClick={() => notify("Secondary action")}>Secondary</Button>
          <Button variant="ghost" onClick={() => notify("Ghost action")}>Ghost</Button>
          <Button variant="danger" onClick={() => notify("Danger action")}>Danger</Button>
          <Button loading>Loading</Button>
          <Button disabled>Disabled</Button>
          <IconButton label="Wallet"><Wallet aria-hidden="true" /></IconButton>
        </div>
      </section>

      <section className="studio-section">
        <div className="studio-section-heading"><h3 className="type-section-title">Inputs</h3><p>52px targets, inline validation, visible focus.</p></div>
        <div className="two-column">
          <Input label="Login ID" placeholder="Enter your login ID" leadingIcon={<UserRound aria-hidden="true" />} />
          <PasswordInput label="Password" placeholder="Enter your password" />
          <Input label="With helper text" placeholder="9876543210" helperText="Ten digit mobile number" />
          <Input label="With error" defaultValue="abc" error="Enter a valid amount" />
        </div>
        <div>
          <p className="specimen-label">OTP appearance (visual only, no delivery)</p>
          <OtpPreview />
        </div>
      </section>

      <section className="studio-section">
        <div className="studio-section-heading"><h3 className="type-section-title">Tabs</h3><p>Animated indicator, keyboard-navigable, respects reduced motion.</p></div>
        <Tabs
          label="Design studio example tabs"
          defaultValue="one"
          items={[
            { value: "one", label: "Overview", content: <p className="text-secondary type-body-small">First panel content.</p> },
            { value: "two", label: "Details", content: <p className="text-secondary type-body-small">Second panel content.</p> },
            { value: "three", label: "Disabled", content: <p className="text-secondary type-body-small">Unreachable panel.</p>, disabled: true },
          ]}
        />
      </section>

      <section className="studio-section">
        <div className="studio-section-heading"><h3 className="type-section-title">Badges &amp; alerts</h3><p>One tone system shared by badges, alerts and status text.</p></div>
        <div className="row">{tones.map((tone) => <Badge key={tone} tone={tone}>{tone}</Badge>)}</div>
        <div className="stack">
          <Alert title="Bets remain open" tone="info">New bets are accepted until the market closes.</Alert>
          <Alert title="Withdrawal pending" tone="warning">This request is awaiting admin review.</Alert>
          <Alert title="Session issue" tone="danger">This is sample copy, not a live error.</Alert>
        </div>
      </section>

      <section className="studio-section">
        <div className="studio-section-heading"><h3 className="type-section-title">Loading, empty &amp; error states</h3><p>Skeletons breathe gently; empty/error states share one layout.</p></div>
        <div className="two-column">
          <CardSkeleton />
          <GlassCard><div className="stack"><Skeleton className="skeleton-label" /><Skeleton /></div></GlassCard>
        </div>
        <div className="two-column">
          <GlassCard><EmptyState icon={<DiamondIcon aria-hidden="true" />} title="No bets yet" description="Selections you place will appear here." /></GlassCard>
          <GlassCard><ErrorState description="Sample copy for the error layout." /></GlassCard>
        </div>
      </section>

      <section className="studio-section">
        <div className="studio-section-heading"><h3 className="type-section-title">Overlays</h3><p>Radix owns focus trapping, scroll lock and dismissal.</p></div>
        <div className="row">
          <Modal trigger={<Button variant="secondary">Open modal</Button>} title="Sample modal" description="Centered dialog used for focused decisions.">
            <p className="text-secondary type-body-small">Modal content area. Escape, overlay click and the close button all dismiss it, and focus returns to the trigger.</p>
          </Modal>
          <BottomSheet trigger={<Button variant="secondary">Open bottom sheet</Button>} title="Sample bottom sheet" description="Mobile-first review surface.">
            <p className="text-secondary type-body-small">The bet review/ticket experience uses this pattern on narrow viewports.</p>
          </BottomSheet>
          <Drawer trigger={<Button variant="secondary">Open drawer</Button>} title="Sample drawer" description="Side navigation for compact layouts.">
            <p className="text-secondary type-body-small">Admin mobile navigation uses this pattern.</p>
          </Drawer>
          <ConfirmationDialog
            trigger={<Button variant="danger">Preview destructive confirm</Button>}
            title="Preview only"
            description="This demonstrates the confirmation pattern used before irreversible actions. No action is performed here."
            confirmLabel="Confirm"
            destructive
            onConfirm={() => notify("Confirmation acknowledged")}
          />
        </div>
      </section>

      <section className="studio-section">
        <div className="studio-section-heading"><h3 className="type-section-title">Number tiles &amp; countdown</h3><p>Tabular numerals, clear selected state.</p></div>
        <div className="row" role="group" aria-label="Sample number selection">
          {["00", "07", "09", "12", "45", "99"].map((value) => (
            <NumberTile key={value} value={value} selected={selectedTile === value} onClick={() => setSelectedTile(value)} />
          ))}
        </div>
        <div className="row">
          <div><p className="specimen-label">Edit window</p><Countdown target={demoInstants?.editWindow ?? invalidInstant} /></div>
          <div><p className="specimen-label">Closing soon</p><Countdown target={demoInstants?.closingSoon ?? invalidInstant} /></div>
        </div>
      </section>

      <section className="studio-section">
        <div className="studio-section-heading"><h3 className="type-section-title">Responsive data pattern</h3><p>Semantic table on desktop, labelled cards below 768px.</p></div>
        <DataTable caption="Sample recent activity" columns={activityColumns} records={activity} recordKey={(row) => row.id} />
      </section>

      <section className="studio-section">
        <div className="studio-section-heading"><h3 className="type-section-title">Navigation primitives</h3><p>Shared brand, nav item and profile menu building blocks.</p></div>
        <GlassPanel>
          <div className="between">
            <span className="type-label">Profile menu</span>
            <ProfileMenu
              name="Preview account"
              items={[
                { label: "Profile", icon: UserRound, onSelect: () => notify("Profile preview") },
                { label: "Support", icon: ShieldAlert, onSelect: () => notify("Support preview") },
                { label: "Confirmed action", icon: CircleCheck, onSelect: () => notify("Confirmed") },
                { label: "Disabled item", icon: Ban, disabled: true },
              ]}
            />
          </div>
        </GlassPanel>
      </section>
    </div>
  );
}
