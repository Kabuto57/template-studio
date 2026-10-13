// The gallery. Each design is a small, opinionated deck: its own palette, type pairing and
// layout, with fields already placed and described so it produces a usable kit straight away.
// Fonts are limited to ones PowerPoint has on both Windows and macOS.
import type { CellStyle } from "../ooxml/edit";
import { shape, table, text, type Design } from "./builder";

const RAG = [
  { match: "High", fill: "FADBD8", text: "A93226" },
  { match: "Medium", fill: "FCEBCF", text: "9C640C" },
  { match: "Low", fill: "D9F2E3", text: "1E7A46" },
];

/* ------------------------------------------------------------------ Boardroom */
const boardroom = ((): Design => {
  const NAVY = "0F1E3C", GOLD = "C8A24A", MIST = "F3F5F9", SLATE = "5B6577", SERIF = "Georgia", SANS = "Arial";
  const heading = (t: string) => [
    text(0.9, 0.62, 11.5, 0.7, t, { sz: 28, b: true, color: NAVY, font: SERIF }),
    shape(0.9, 1.42, 0.9, 0.05, GOLD),
  ];
  const kpi = (i: number, field: string, label: string) => text(0.9 + i * 2.95, 1.95, 2.7, 2.25,
    [{ text: `{{${field}}}`, sz: 40, b: true, color: NAVY, font: SERIF }, { text: label, sz: 14, color: SLATE, font: SANS }],
    {}, { fill: MIST, geom: "roundRect", radius: 6000, anchor: "ctr", ins: 0.22 });
  const head: CellStyle = { fill: NAVY, color: "FFFFFF", font: SANS, sz: 13, border: null };
  const body: CellStyle = { font: SANS, sz: 14, color: "1F2937", border: "E3E7EE" };
  return {
    id: "boardroom", name: "Boardroom", blurb: "Board and committee updates", palette: [NAVY, GOLD, MIST],
    slides: [
      { bg: NAVY, els: [
        shape(8.9, -1.6, 6.6, 6.6, null, { geom: "ellipse", line: GOLD, lineW: 12700 }),
        shape(10.4, 3.6, 4.4, 4.4, "17294F", { geom: "ellipse" }),
        shape(0.9, 1.25, 0.9, 0.05, GOLD),
        text(0.9, 1.5, 7, 0.4, "{{company_name}}", { sz: 14, color: GOLD, font: SANS, b: true }),
        text(0.9, 2.2, 8.2, 2.4, "{{report_title}}", { sz: 54, b: true, color: "FFFFFF", font: SERIF }, { anchor: "b" }),
        text(0.9, 4.8, 8.2, 0.5, "{{period}}", { sz: 18, color: "C9D1E0", font: SANS }),
        text(0.9, 6.45, 8.2, 0.4, "Prepared by {{prepared_by}}", { sz: 12, color: "8E9AB3", font: SANS }),
      ] },
      { bg: "FFFFFF", els: [
        ...heading("Performance at a glance"),
        kpi(0, "revenue", "Revenue"), kpi(1, "growth", "Growth on last year"), kpi(2, "margin", "Operating margin"), kpi(3, "cash", "Cash position"),
        text(0.9, 4.6, 3, 0.4, "Summary", { sz: 14, b: true, color: GOLD, font: SANS }),
        text(0.9, 5.05, 11.5, 1.9, "{{summary}}", { sz: 20, color: "1F2937", font: SANS, line: 1.1 }),
      ] },
      { bg: "FFFFFF", els: [
        ...heading("Matters for the board"),
        text(0.9, 1.9, 4.4, 0.4, "Highlights", { sz: 14, b: true, color: GOLD, font: SANS }),
        text(0.9, 2.4, 4.4, 4.4, "{{highlights}}", { sz: 18, color: "1F2937", font: SANS, bullet: true, after: 10 }),
        text(5.8, 1.9, 6.6, 0.4, "Decisions required", { sz: 14, b: true, color: GOLD, font: SANS }),
        table(5.8, 2.4, 6.63, "decisions", { rows: 4, head, body, band: "F7F8FB", rowH: 0.95, headH: 0.5,
          cols: [{ key: "decision", label: "Decision", w: 3 }, { key: "owner", label: "Owner", w: 1.5 }, { key: "due", label: "Due", w: 1.1 }] }),
      ] },
    ],
    project: {
      settings: { file_name_field: "report_title", colour_rules: [] },
      fields: {
        company_name: { desc: "Company name", example: "Northwind Group" },
        report_title: { desc: "Title of the update", max: 6, example: "Board update" },
        period: { desc: "Period covered", example: "Third quarter 2026" },
        prepared_by: { desc: "Who prepared it", example: "Office of the CFO" },
        revenue: { desc: "Revenue for the period, with unit", max: 2, example: "$48.2m" },
        growth: { desc: "Year-on-year growth, with sign", max: 1, example: "+12%" },
        margin: { desc: "Operating margin", max: 1, example: "18.4%" },
        cash: { desc: "Closing cash, with unit", max: 2, example: "$21.7m" },
        summary: { desc: "What happened and what it means for the board", max: 70, example: "Revenue grew 12% on last year, led by the enterprise segment. Margin held at 18.4% despite higher cloud costs. Cash is ahead of plan, which gives room to bring the Jakarta launch forward by a quarter." },
        highlights: { type: "list", desc: "Most important points, good and bad", max: 14, example: "Enterprise bookings up 31% on last year\nTwo of five strategic hires completed\nCustomer churn rose to 4.1% in the SME segment\nJakarta launch is on schedule for February" },
        "decisions[]": { desc: "most urgent first" },
        "decisions[].decision": { desc: "What the board is asked to approve", max: 12, example: "Approve $3.5m for the Jakarta launch\nAppoint KPMG as auditor for 2027\nAdopt the revised risk appetite statement" },
        "decisions[].owner": { desc: "Executive responsible", max: 3, example: "CEO\nAudit Committee Chair\nChief Risk Officer" },
        "decisions[].due": { desc: "Date needed", example: "30 Nov 2026\n15 Dec 2026\n15 Dec 2026" },
      },
    },
    test: {
      company_name: "Northwind Group", report_title: "Board update", period: "Third quarter 2026", prepared_by: "Office of the CFO",
      revenue: "$48.2m", growth: "+12%", margin: "18.4%", cash: "$21.7m",
      summary: "Revenue grew 12% on last year, led by the enterprise segment. Margin held at 18.4% despite higher cloud costs. Cash is ahead of plan, which gives room to bring the Jakarta launch forward by a quarter.",
      highlights: ["Enterprise bookings up 31% on last year", "Two of five strategic hires completed", "Customer churn rose to 4.1% in the SME segment", "Jakarta launch is on schedule for February"],
      decisions: [
        { decision: "Approve $3.5m for the Jakarta launch", owner: "CEO", due: "30 Nov 2026" },
        { decision: "Appoint KPMG as auditor for 2027", owner: "Audit Committee Chair", due: "15 Dec 2026" },
        { decision: "Adopt the revised risk appetite statement", owner: "Chief Risk Officer", due: "15 Dec 2026" },
      ],
    },
  };
})();

/* ------------------------------------------------------------------ Signal */
const signal = ((): Design => {
  const TEAL = "0B6E6E", INK = "12263A", MINT = "E4F3F0", SLATE = "5A6B7B", SANS = "Trebuchet MS", BODY = "Arial";
  const heading = (t: string) => [
    shape(0, 0, 0.28, 7.5, TEAL),
    text(0.9, 0.6, 9, 0.7, t, { sz: 28, b: true, color: INK, font: SANS }),
  ];
  const tile = (x: number, y: number, field: string, label: string) => text(x, y, 2.15, 1.9,
    [{ text: `{{${field}}}`, sz: 40, b: true, color: TEAL, font: SANS }, { text: label, sz: 14, color: SLATE, font: BODY }],
    {}, { fill: MINT, geom: "roundRect", radius: 9000, anchor: "ctr", ins: 0.2 });
  const head: CellStyle = { fill: INK, color: "FFFFFF", font: BODY, sz: 13, border: null };
  const body: CellStyle = { font: BODY, sz: 14, color: INK, border: "DDE5EA" };
  return {
    id: "signal", name: "Signal", blurb: "Project status reports", palette: [TEAL, INK, MINT],
    slides: [
      { bg: "FFFFFF", els: [
        shape(0, 0, 4.9, 7.5, TEAL),
        shape(3.3, 5.2, 3.2, 3.2, "0F8483", { geom: "ellipse" }),
        text(0.7, 0.75, 3.6, 0.4, "Project status", { sz: 14, b: true, color: "BFE6E1", font: BODY }),
        text(0.7, 1.4, 3.8, 3.4, "{{project_name}}", { sz: 40, b: true, color: "FFFFFF", font: SANS }),
        text(0.7, 6.4, 3.8, 0.4, "{{reporting_period}}", { sz: 14, color: "BFE6E1", font: BODY }),
        text(5.6, 0.75, 6.9, 0.4, "Where we are", { sz: 14, b: true, color: TEAL, font: BODY }),
        text(5.6, 1.3, 6.9, 2.9, "{{status_summary}}", { sz: 22, color: INK, font: BODY, line: 1.1 }),
        tile(5.6, 4.6, "percent_complete", "Complete"), tile(7.975, 4.6, "budget_used", "Budget used"), tile(10.35, 4.6, "days_to_launch", "Days to launch"),
      ] },
      { bg: "FFFFFF", els: [
        ...heading("Workstreams"),
        text(9.6, 0.5, 2.9, 1, [{ text: "{{count:workstreams.status=At risk}}", sz: 30, b: true, color: "9C640C", font: SANS, algn: "r" }, { text: "at risk", sz: 14, color: SLATE, font: BODY, algn: "r" }]),
        table(0.9, 1.75, 11.6, "workstreams", { rows: 6, head, body, band: "F5F9F9", rowH: 0.76, headH: 0.5,
          cols: [{ key: "name", label: "Workstream", w: 2.4 }, { key: "status", label: "Status", w: 1.2 }, { key: "progress", label: "Progress", w: 1 }, { key: "next_step", label: "Next step", w: 4 }] }),
      ] },
      { bg: "FFFFFF", els: [
        ...heading("Risks and next steps"),
        table(0.9, 1.75, 7.1, "risks", { rows: 4, head, body, band: "F5F9F9", rowH: 1.1, headH: 0.5,
          cols: [{ key: "risk", label: "Risk", w: 2.6 }, { key: "impact", label: "Impact", w: 1 }, { key: "mitigation", label: "Mitigation", w: 3 }] }),
        shape(8.5, 1.75, 4, 4.95, MINT, { geom: "roundRect", radius: 5000 }),
        text(8.85, 2.05, 3.3, 0.4, "Next two weeks", { sz: 14, b: true, color: TEAL, font: BODY }),
        text(8.85, 2.6, 3.3, 3.9, "{{next_steps}}", { sz: 17, color: INK, font: BODY, bullet: true, after: 10 }),
      ] },
    ],
    project: {
      settings: {
        file_name_field: "project_name",
        colour_rules: [
          { match: "On track", fill: "D9F2E3", text: "1E7A46" }, { match: "At risk", fill: "FCEBCF", text: "9C640C" },
          { match: "Off track", fill: "FADBD8", text: "A93226" }, ...RAG,
        ],
      },
      fields: {
        project_name: { desc: "Project name", max: 5, example: "Customer Portal Relaunch" },
        reporting_period: { desc: "Dates this report covers", example: "Two weeks to 9 October 2026" },
        status_summary: { desc: "Overall position in plain words", max: 55, example: "Build is 68% complete and on budget. Single sign-on slipped a week after a vendor API change, which puts the 1 December launch at risk unless testing is compressed." },
        percent_complete: { desc: "Overall completion", max: 1, example: "68%" },
        budget_used: { desc: "Share of budget spent", max: 1, example: "61%" },
        days_to_launch: { desc: "Days until launch", max: 1, example: "53" },
        "workstreams[]": { desc: "in delivery order" },
        "workstreams[].name": { desc: "Workstream", max: 4, example: "Design system\nSingle sign-on\nPayments\nData migration" },
        "workstreams[].status": { desc: "Status", allowed: "On track, At risk, Off track", example: "On track\nAt risk\nOn track\nOff track" },
        "workstreams[].progress": { desc: "Percent complete", max: 1, example: "90%\n55%\n70%\n35%" },
        "workstreams[].next_step": { desc: "The next concrete step", max: 14, example: "Hand over final components to engineering\nRetest against the vendor's new API\nStart penetration testing\nAgree a cut-over weekend with operations" },
        "risks[]": { desc: "highest impact first" },
        "risks[].risk": { desc: "What could go wrong", max: 12, example: "Vendor API changes again before launch\nMigration overruns the cut-over weekend" },
        "risks[].impact": { desc: "Impact", allowed: "High, Medium, Low", example: "High\nMedium" },
        "risks[].mitigation": { desc: "What we are doing about it", max: 16, example: "Pin the API version and agree a change freeze\nRun two full rehearsals in November" },
        next_steps: { type: "list", desc: "What happens before the next report", max: 12, example: "Retest single sign-on by 16 October\nBook the cut-over weekend\nConfirm launch communications with marketing" },
      },
    },
    test: {
      project_name: "Customer Portal Relaunch", reporting_period: "Two weeks to 9 October 2026",
      status_summary: "Build is 68% complete and on budget. Single sign-on slipped a week after a vendor API change, which puts the 1 December launch at risk unless testing is compressed.",
      percent_complete: "68%", budget_used: "61%", days_to_launch: "53",
      workstreams: [
        { name: "Design system", status: "On track", progress: "90%", next_step: "Hand over final components to engineering" },
        { name: "Single sign-on", status: "At risk", progress: "55%", next_step: "Retest against the vendor's new API" },
        { name: "Payments", status: "On track", progress: "70%", next_step: "Start penetration testing" },
        { name: "Data migration", status: "Off track", progress: "35%", next_step: "Agree a cut-over weekend with operations" },
      ],
      risks: [
        { risk: "Vendor API changes again before launch", impact: "High", mitigation: "Pin the API version and agree a change freeze" },
        { risk: "Migration overruns the cut-over weekend", impact: "Medium", mitigation: "Run two full rehearsals in November" },
      ],
      next_steps: ["Retest single sign-on by 16 October", "Book the cut-over weekend", "Confirm launch communications with marketing"],
    },
  };
})();

/* ------------------------------------------------------------------ Headline */
const headline = ((): Design => {
  const INK = "1B1B1F", CORAL = "FF5A4E", SAND = "F4EEE8", GREY = "6E6A66", SANS = "Arial";
  const column = (x: number, title: string, field: string, fill: string, ink: string) => [
    shape(x, 1.8, 3.75, 4.9, fill, { geom: "roundRect", radius: 5000 }),
    text(x + 0.35, 2.1, 3.05, 0.5, title, { sz: 22, b: true, color: ink, font: SANS }),
    text(x + 0.35, 2.85, 3.05, 3.6, `{{${field}}}`, { sz: 17, color: ink, font: SANS, bullet: true, after: 10 }),
  ];
  const big = (x: number, field: string, label: string) => [
    text(x, 2, 3.7, 1.5, `{{${field}}}`, { sz: 66, b: true, color: CORAL, font: SANS }, { anchor: "b" }),
    text(x, 3.6, 3.7, 0.5, label, { sz: 16, color: GREY, font: SANS }),
  ];
  return {
    id: "headline", name: "Headline", blurb: "Quarterly business reviews", palette: [INK, CORAL, SAND],
    slides: [
      { bg: INK, els: [
        shape(8.4, 1.5, 7.2, 7.2, CORAL, { geom: "ellipse" }),
        shape(7.2, 0.9, 1.5, 1.5, "FFD7C2", { geom: "ellipse" }),
        text(0.9, 0.9, 5, 0.5, "{{quarter}}", { sz: 20, b: true, color: CORAL, font: SANS }),
        text(0.9, 2, 7.2, 3.2, "{{title}}", { sz: 56, b: true, color: "FFFFFF", font: SANS }, { anchor: "b" }),
        text(0.9, 5.5, 7, 0.5, "{{team}}", { sz: 16, color: "B8B4B0", font: SANS }),
      ] },
      { bg: "FFFFFF", els: [
        text(0.9, 0.7, 11.5, 0.7, "The quarter in numbers", { sz: 28, b: true, color: INK, font: SANS }),
        ...big(0.9, "revenue", "Revenue"), shape(4.75, 2.3, 0.02, 1.7, "DDD6CF"),
        ...big(5.05, "new_customers", "New customers"), shape(8.9, 2.3, 0.02, 1.7, "DDD6CF"),
        ...big(9.2, "net_promoter_score", "Net promoter score"),
        shape(0.9, 4.75, 11.53, 1.95, SAND, { geom: "roundRect", radius: 7000 }),
        text(1.3, 4.95, 10.7, 1.55, "{{takeaway}}", { sz: 24, b: true, color: INK, font: SANS }, { anchor: "ctr" }),
      ] },
      { bg: "FFFFFF", els: [
        text(0.9, 0.7, 11.5, 0.7, "What worked, what didn't, what's next", { sz: 28, b: true, color: INK, font: SANS }),
        ...column(0.9, "Wins", "wins", SAND, INK), ...column(4.8, "Misses", "misses", SAND, INK), ...column(8.7, "Next quarter", "priorities", INK, "FFFFFF"),
      ] },
    ],
    project: {
      settings: { file_name_field: "title", colour_rules: [] },
      fields: {
        quarter: { desc: "Quarter and year", example: "Q3 2026" },
        title: { desc: "Title of the review", max: 6, example: "Growth team quarterly review" },
        team: { desc: "Team and presenter", example: "Growth team, presented by Priya Raman" },
        revenue: { desc: "Revenue, short form", max: 1, example: "$4.8m" },
        new_customers: { desc: "New customers won", max: 1, example: "312" },
        net_promoter_score: { desc: "Net promoter score", max: 1, example: "47" },
        takeaway: { desc: "The one sentence the audience should remember", max: 24, example: "We beat the revenue target by 9%, but two thirds of it came from one channel that is getting more expensive." },
        wins: { type: "list", desc: "What went well", max: 12, example: "Paid search cost per lead fell 18%\nSelf-serve checkout launched on time\nReferral programme drove 71 new customers" },
        misses: { type: "list", desc: "What fell short", max: 12, example: "Partner channel delivered 40% of target\nOnboarding completion stuck at 62%" },
        priorities: { type: "list", desc: "Priorities for next quarter", max: 12, example: "Rebuild onboarding around the first invoice\nSign three reseller partners\nCut reliance on paid search to under half" },
      },
    },
    test: {
      quarter: "Q3 2026", title: "Growth team quarterly review", team: "Growth team, presented by Priya Raman",
      revenue: "$4.8m", new_customers: "312", net_promoter_score: "47",
      takeaway: "We beat the revenue target by 9%, but two thirds of it came from one channel that is getting more expensive.",
      wins: ["Paid search cost per lead fell 18%", "Self-serve checkout launched on time", "Referral programme drove 71 new customers"],
      misses: ["Partner channel delivered 40% of target", "Onboarding completion stuck at 62%"],
      priorities: ["Rebuild onboarding around the first invoice", "Sign three reseller partners", "Cut reliance on paid search to under half"],
    },
  };
})();

/* ------------------------------------------------------------------ Postmortem */
const postmortem = ((): Design => {
  const BG = "14171C", PANEL = "1E232B", RED = "F2555A", TEXT = "E8EAED", DIM = "98A1AE", SANS = "Arial", MONO = "Courier New";
  const fact = (i: number, field: string, label: string) => text(0.9 + i * 2.95, 4.85, 2.7, 1.7,
    [{ text: label, sz: 13, color: DIM, font: SANS, after: 4 }, { text: `{{${field}}}`, sz: 28, b: true, color: TEXT, font: SANS }],
    {}, { fill: PANEL, geom: "roundRect", radius: 6000, anchor: "ctr", ins: 0.22 });
  const heading = (t: string) => [
    text(0.9, 0.6, 11.5, 0.7, t, { sz: 28, b: true, color: TEXT, font: SANS }),
    shape(0.9, 1.4, 11.53, 0.02, "2D343F"),
  ];
  const head: CellStyle = { fill: PANEL, color: DIM, font: SANS, sz: 13, border: "2D343F" };
  const body: CellStyle = { font: SANS, sz: 14, color: TEXT, border: "2D343F", fill: BG };
  return {
    id: "postmortem", name: "Postmortem", blurb: "Incident and outage reports", palette: [BG, RED, "E8EAED"],
    slides: [
      { bg: BG, els: [
        shape(0.9, 0.95, 0.14, 0.14, RED, { geom: "ellipse" }),
        text(1.15, 0.82, 6, 0.4, "Incident report", { sz: 13, b: true, color: RED, font: SANS }),
        text(0.9, 1.6, 11, 2.3, "{{incident_title}}", { sz: 48, b: true, color: TEXT, font: SANS }, { anchor: "b" }),
        text(0.9, 4.05, 11, 0.45, "{{incident_id}}", { sz: 16, color: DIM, font: MONO }),
        fact(0, "severity", "Severity"), fact(1, "duration", "Duration"), fact(2, "customers_affected", "Customers affected"), fact(3, "incident_date", "Date"),
      ] },
      { bg: BG, els: [
        ...heading("What happened"),
        table(0.9, 1.75, 6.9, "timeline", { rows: 6, head, body, band: null, rowH: 0.76, headH: 0.5,
          cols: [{ key: "time", label: "Time", w: 1 }, { key: "event", label: "Event", w: 4.4 }] }),
        shape(8.3, 1.75, 4.13, 4.95, PANEL, { geom: "roundRect", radius: 5000 }),
        text(8.65, 2.05, 3.45, 0.4, "Root cause", { sz: 14, b: true, color: RED, font: SANS }),
        text(8.65, 2.6, 3.45, 3.9, "{{root_cause}}", { sz: 17, color: TEXT, font: SANS, line: 1.1 }),
      ] },
      { bg: BG, els: [
        ...heading("What we are changing"),
        table(0.9, 1.75, 7.6, "actions", { rows: 5, head, body, band: null, rowH: 0.9, headH: 0.5,
          cols: [{ key: "action", label: "Action", w: 3.2 }, { key: "owner", label: "Owner", w: 1.3 }, { key: "due", label: "Due", w: 1 }, { key: "priority", label: "Priority", w: 0.9 }] }),
        text(8.95, 1.75, 3.5, 0.4, "Lessons", { sz: 14, b: true, color: RED, font: SANS }),
        text(8.95, 2.3, 3.5, 4.4, "{{lessons}}", { sz: 16, color: TEXT, font: SANS, bullet: true, after: 10 }),
      ] },
    ],
    project: {
      settings: {
        file_name_field: "incident_id",
        colour_rules: [{ match: "P1", fill: "5A1E22", text: "FFB3B5" }, { match: "P2", fill: "4A3A14", text: "FFD98A" }, { match: "P3", fill: "1E3A2A", text: "A6E3BD" }],
      },
      fields: {
        incident_title: { desc: "One line describing the incident", max: 10, example: "Checkout unavailable for card payments" },
        incident_id: { desc: "Incident reference", example: "INC-2026-1042" },
        severity: { desc: "Severity level", allowed: "SEV1, SEV2, SEV3", example: "SEV1" },
        duration: { desc: "Time from start to recovery", max: 3, example: "1 h 47 min" },
        customers_affected: { desc: "How many customers were affected", max: 2, example: "18,400" },
        incident_date: { desc: "Date of the incident", example: "6 Oct 2026" },
        "timeline[]": { desc: "in time order" },
        "timeline[].time": { desc: "Time (24 h)", example: "09:12\n09:19\n09:41\n10:22\n10:59" },
        "timeline[].event": { desc: "What happened", max: 16, example: "Deploy 4.18 rolled out to all regions\nError rate on card payments passed 30%\nIncident declared, rollback started\nRollback blocked by a failed database migration\nMigration reverted by hand, payments recovered" },
        root_cause: { desc: "The underlying cause, not the trigger", max: 60, example: "A schema migration in deploy 4.18 dropped a column the payments service still read. The migration ran before the service was updated because the two were released from separate pipelines with no ordering check." },
        "actions[]": { desc: "highest priority first" },
        "actions[].action": { desc: "What will change", max: 14, example: "Block deploys when a migration removes a column in use\nAdd card payment success rate to the release gate\nRehearse database rollback every quarter" },
        "actions[].owner": { desc: "Team responsible", max: 3, example: "Platform\nPayments\nSRE" },
        "actions[].due": { desc: "Due date", example: "23 Oct 2026\n30 Oct 2026\n15 Dec 2026" },
        "actions[].priority": { desc: "Priority", allowed: "P1, P2, P3", example: "P1\nP1\nP2" },
        lessons: { type: "list", desc: "What the team learned", max: 16, example: "Rollback is not a plan if the database has already changed\nThe alert fired seven minutes before anyone was paged\nStatus page updates were fast and reduced support tickets" },
      },
    },
    test: {
      incident_title: "Checkout unavailable for card payments", incident_id: "INC-2026-1042", severity: "SEV1",
      duration: "1 h 47 min", customers_affected: "18,400", incident_date: "6 Oct 2026",
      timeline: [
        { time: "09:12", event: "Deploy 4.18 rolled out to all regions" },
        { time: "09:19", event: "Error rate on card payments passed 30%" },
        { time: "09:41", event: "Incident declared, rollback started" },
        { time: "10:22", event: "Rollback blocked by a failed database migration" },
        { time: "10:59", event: "Migration reverted by hand, payments recovered" },
      ],
      root_cause: "A schema migration in deploy 4.18 dropped a column the payments service still read. The migration ran before the service was updated because the two were released from separate pipelines with no ordering check.",
      actions: [
        { action: "Block deploys when a migration removes a column in use", owner: "Platform", due: "23 Oct 2026", priority: "P1" },
        { action: "Add card payment success rate to the release gate", owner: "Payments", due: "30 Oct 2026", priority: "P1" },
        { action: "Rehearse database rollback every quarter", owner: "SRE", due: "15 Dec 2026", priority: "P2" },
      ],
      lessons: ["Rollback is not a plan if the database has already changed", "The alert fired seven minutes before anyone was paged", "Status page updates were fast and reduced support tickets"],
    },
  };
})();

/* ------------------------------------------------------------------ Orchard */
const orchard = ((): Design => {
  const PLUM = "43204D", LILAC = "EFE7F4", LIME = "CFEA5B", INK = "2A1830", MAUVE = "7C6A84", SERIF = "Georgia", SANS = "Arial";
  const heading = (t: string) => text(0.9, 0.65, 11.5, 0.8, t, { sz: 30, b: true, color: PLUM, font: SERIF });
  const head: CellStyle = { fill: PLUM, color: "FFFFFF", font: SANS, sz: 13, border: null };
  const body: CellStyle = { font: SANS, sz: 14, color: INK, border: "E2D8E8" };
  return {
    id: "orchard", name: "Orchard", blurb: "Client proposals", palette: [PLUM, LIME, LILAC],
    slides: [
      { bg: LILAC, els: [
        shape(8.2, 0, 5.133, 7.5, PLUM),
        shape(7.25, 2.6, 1.9, 1.9, LIME, { geom: "ellipse" }),
        text(0.9, 0.9, 6, 0.4, "Proposal for {{client_name}}", { sz: 16, b: true, color: MAUVE, font: SANS }),
        text(0.9, 1.9, 6.2, 3.3, "{{proposal_title}}", { sz: 46, b: true, color: PLUM, font: SERIF }, { anchor: "b" }),
        text(0.9, 5.5, 6, 0.5, "{{proposal_date}}", { sz: 14, color: MAUVE, font: SANS }),
        text(9.5, 5.6, 3.2, 1.1, [{ text: "{{our_company}}", sz: 16, b: true, color: "FFFFFF", font: SANS }, { text: "{{contact}}", sz: 12, color: "CDBBD6", font: SANS }]),
      ] },
      { bg: "FFFFFF", els: [
        heading("The opportunity"),
        text(0.9, 1.8, 5.6, 4.8, "{{problem}}", { sz: 28, color: INK, font: SERIF, line: 1.1 }),
        shape(7.1, 1.8, 5.33, 4.9, LILAC, { geom: "roundRect", radius: 5000 }),
        text(7.5, 2.1, 4.5, 0.4, "What we propose", { sz: 14, b: true, color: PLUM, font: SANS }),
        text(7.5, 2.7, 4.5, 3.8, "{{approach}}", { sz: 18, color: INK, font: SANS, bullet: true, after: 10 }),
      ] },
      { bg: "FFFFFF", els: [
        heading("Plan and investment"),
        table(0.9, 1.8, 8, "phases", { rows: 4, head, body, band: "F8F4FA", rowH: 1.05, headH: 0.5,
          cols: [{ key: "phase", label: "Phase", w: 1.6 }, { key: "deliverable", label: "What you get", w: 3.4 }, { key: "timeline", label: "When", w: 1.2 }, { key: "fee", label: "Fee", w: 1 }] }),
        text(9.3, 1.8, 3.13, 2.2, [{ text: "Total investment", sz: 14, color: "E4D6EA", font: SANS }, { text: "{{total_fee}}", sz: 38, b: true, color: LIME, font: SERIF }],
          {}, { fill: PLUM, geom: "roundRect", radius: 7000, anchor: "ctr", ins: 0.3 }),
        text(9.3, 4.3, 3.13, 0.4, "Next step", { sz: 14, b: true, color: PLUM, font: SANS }),
        text(9.3, 4.8, 3.13, 2, "{{next_step}}", { sz: 16, color: INK, font: SANS, line: 1.1 }),
      ] },
    ],
    project: {
      settings: { file_name_field: "proposal_title", colour_rules: [] },
      fields: {
        client_name: { desc: "Client's company name", example: "Harbourline Logistics" },
        proposal_title: { desc: "What we are proposing, as a title", max: 8, example: "A faster way to quote freight" },
        proposal_date: { desc: "Date of the proposal", example: "13 October 2026" },
        our_company: { desc: "Our company name", example: "Fieldnote Studio" },
        contact: { desc: "Contact person and email", example: "Aisha Tan, aisha@fieldnote.example" },
        problem: { desc: "The client's problem in their own terms", max: 45, example: "Your team spends two days building each freight quote by hand. One in four customers has chosen another carrier by the time the quote arrives." },
        approach: { type: "list", desc: "What we will do", max: 14, example: "Map the quoting process with your pricing team\nBuild a quote calculator on your existing rate cards\nPilot with ten account managers for four weeks\nTrain the full team and hand over" },
        "phases[]": { desc: "in delivery order" },
        "phases[].phase": { desc: "Phase name", max: 3, example: "Discover\nBuild\nPilot\nRoll out" },
        "phases[].deliverable": { desc: "What the client receives", max: 12, example: "Process map and pricing rules\nWorking quote calculator\nPilot results and fixes\nTraining and handover" },
        "phases[].timeline": { desc: "Duration or dates", example: "2 weeks\n5 weeks\n4 weeks\n2 weeks" },
        "phases[].fee": { desc: "Fee for the phase", example: "$12,000\n$38,000\n$14,000\n$9,000" },
        total_fee: { desc: "Total fee", max: 1, example: "$73,000" },
        next_step: { desc: "What we ask the client to do next", max: 25, example: "A one-hour session with your pricing lead next week to confirm scope. We can start on 2 November." },
      },
    },
    test: {
      client_name: "Harbourline Logistics", proposal_title: "A faster way to quote freight", proposal_date: "13 October 2026",
      our_company: "Fieldnote Studio", contact: "Aisha Tan, aisha@fieldnote.example",
      problem: "Your team spends two days building each freight quote by hand. One in four customers has chosen another carrier by the time the quote arrives.",
      approach: ["Map the quoting process with your pricing team", "Build a quote calculator on your existing rate cards", "Pilot with ten account managers for four weeks", "Train the full team and hand over"],
      phases: [
        { phase: "Discover", deliverable: "Process map and pricing rules", timeline: "2 weeks", fee: "$12,000" },
        { phase: "Build", deliverable: "Working quote calculator", timeline: "5 weeks", fee: "$38,000" },
        { phase: "Pilot", deliverable: "Pilot results and fixes", timeline: "4 weeks", fee: "$14,000" },
        { phase: "Roll out", deliverable: "Training and handover", timeline: "2 weeks", fee: "$9,000" },
      ],
      total_fee: "$73,000",
      next_step: "A one-hour session with your pricing lead next week to confirm scope. We can start on 2 November.",
    },
  };
})();

export const DESIGNS: Design[] = [boardroom, signal, headline, postmortem, orchard];
