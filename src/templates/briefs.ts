// Bank briefs: plain red, charcoal and white decks for internal papers. Lots of white space,
// one red accent per slide, Arial throughout so they open the same on any work laptop.
import type { CellStyle } from "../ooxml/edit";
import { shape, table, text, type Design } from "./builder";

const RED = "D7182A", INK = "1D1D1F", GREY = "6B6B70", MIST = "F4F4F5", RULE = "E4E4E7", SANS = "Arial";
const RAG = [
  { match: "High", fill: "FADBD8", text: "A93226" },
  { match: "Medium", fill: "FCEBCF", text: "9C640C" },
  { match: "Low", fill: "D9F2E3", text: "1E7A46" },
];
const head: CellStyle = { fill: INK, color: "FFFFFF", font: SANS, sz: 13, border: null };
const body: CellStyle = { font: SANS, sz: 14, color: INK, border: RULE };

/** Red tick, slide title and a quiet footer: the frame every inside slide shares. */
const frame = (title: string, footer: string) => [
  shape(0.9, 0.6, 0.5, 0.07, RED),
  text(0.9, 0.8, 11.5, 0.7, title, { sz: 28, b: true, color: INK, font: SANS }),
  shape(0.9, 6.85, 11.53, 0.01, RULE),
  text(0.9, 6.95, 8, 0.3, footer, { sz: 10, color: GREY, font: SANS }),
];
const label = (x: number, y: number, w: number, t: string, color = RED) => text(x, y, w, 0.4, t, { sz: 13, b: true, color, font: SANS });
const fact = (x: number, y: number, w: number, field: string, name: string) => text(x, y, w, 1.5,
  [{ text: name, sz: 12, color: GREY, font: SANS, after: 4 }, { text: `{{${field}}}`, sz: 26, b: true, color: INK, font: SANS }],
  {}, { fill: MIST, anchor: "ctr", ins: 0.22 });

/* ------------------------------------------------------------------ Brief */
const brief: Design = {
  id: "brief", name: "Brief", blurb: "One-idea executive brief", palette: [RED, INK, MIST],
  slides: [
    { bg: "FFFFFF", els: [
      shape(0, 0, 0.35, 7.5, RED),
      label(1.2, 1.2, 8, "EXECUTIVE BRIEF"),
      text(1.2, 1.8, 10, 2.6, "{{brief_title}}", { sz: 44, b: true, color: INK, font: SANS }, { anchor: "b" }),
      shape(1.2, 4.65, 1.2, 0.04, INK),
      text(1.2, 4.9, 10, 0.5, "{{business_unit}}  |  {{brief_date}}", { sz: 18, color: GREY, font: SANS }),
      text(1.2, 6.5, 10, 0.4, "Prepared by {{prepared_by}}", { sz: 12, color: GREY, font: SANS }),
    ] },
    { bg: "FFFFFF", els: [
      ...frame("The situation", "Executive brief  |  Internal"),
      text(0.9, 1.8, 6.4, 4.8, "{{situation}}", { sz: 22, color: INK, font: SANS, line: 1.15 }),
      shape(7.8, 1.8, 4.63, 4.8, MIST),
      label(8.15, 2.1, 4, "KEY POINTS"),
      text(8.15, 2.65, 3.95, 3.8, "{{key_points}}", { sz: 16, color: INK, font: SANS, bullet: true, after: 10 }),
    ] },
    { bg: "FFFFFF", els: [
      ...frame("What we recommend", "Executive brief  |  Internal"),
      text(0.9, 1.8, 5.4, 2.6, "{{recommendation}}", { sz: 22, b: true, color: "FFFFFF", font: SANS, line: 1.1 }, { fill: RED, anchor: "ctr", ins: 0.3 }),
      label(0.9, 4.7, 5, "WE ASK YOU TO", INK),
      text(0.9, 5.15, 5.4, 1.5, "{{the_ask}}", { sz: 16, color: INK, font: SANS, line: 1.1 }),
      label(6.8, 1.8, 5, "NEXT STEPS", INK),
      table(6.8, 2.3, 5.63, "next_steps", { rows: 4, head, body, band: "FAFAFA", rowH: 0.85, headH: 0.5,
        cols: [{ key: "action", label: "Action", w: 3.2 }, { key: "owner", label: "Owner", w: 1.3 }, { key: "by", label: "By", w: 1.1 }] }),
    ] },
  ],
  project: {
    settings: { file_name_field: "brief_title", colour_rules: [] },
    fields: {
      brief_title: { desc: "The brief's title, stated as the main point", max: 10, example: "Move SME onboarding fully online by Q2" },
      business_unit: { desc: "Team or business unit writing the brief", example: "SME Banking, Singapore" },
      brief_date: { desc: "Date of the brief", example: "19 October 2026" },
      prepared_by: { desc: "Author and role", example: "Tan Wei Ling, Product Lead" },
      situation: { desc: "What is happening and why it matters now, in plain words", max: 60, example: "Opening an SME account takes nine working days and two branch visits. Competitors now do it in one day online, and a third of applicants who start with us never finish. Branch staff spend about 40% of their time on onboarding paperwork." },
      key_points: { type: "list", desc: "Facts that support the situation", max: 14, example: "34% of SME applications are abandoned before approval\nMyInfo Business already covers 80% of the data we ask for\nTwo competitors launched same-day online opening this year\nBranch onboarding costs about $180 per account" },
      recommendation: { desc: "The recommendation in one or two sentences", max: 30, example: "Launch fully online SME account opening using MyInfo Business, starting with sole proprietors in Q1 and all companies by Q2." },
      the_ask: { desc: "The decision or support needed from the reader", max: 35, example: "Approve $1.2m from the 2027 digital budget and nominate a Compliance partner for the design phase." },
      "next_steps[]": { desc: "in date order" },
      "next_steps[].action": { desc: "What will be done", max: 10, example: "Confirm budget at the November committee\nComplete Compliance design review\nPilot with 200 sole proprietors" },
      "next_steps[].owner": { desc: "Person or team responsible", max: 3, example: "Head of SME\nCompliance\nProduct team" },
      "next_steps[].by": { desc: "Target date", example: "20 Nov 2026\n15 Dec 2026\n31 Jan 2027" },
    },
  },
  test: {
    brief_title: "Move SME onboarding fully online by Q2", business_unit: "SME Banking, Singapore", brief_date: "19 October 2026", prepared_by: "Tan Wei Ling, Product Lead",
    situation: "Opening an SME account takes nine working days and two branch visits. Competitors now do it in one day online, and a third of applicants who start with us never finish. Branch staff spend about 40% of their time on onboarding paperwork.",
    key_points: ["34% of SME applications are abandoned before approval", "MyInfo Business already covers 80% of the data we ask for", "Two competitors launched same-day online opening this year", "Branch onboarding costs about $180 per account"],
    recommendation: "Launch fully online SME account opening using MyInfo Business, starting with sole proprietors in Q1 and all companies by Q2.",
    the_ask: "Approve $1.2m from the 2027 digital budget and nominate a Compliance partner for the design phase.",
    next_steps: [
      { action: "Confirm budget at the November committee", owner: "Head of SME", by: "20 Nov 2026" },
      { action: "Complete Compliance design review", owner: "Compliance", by: "15 Dec 2026" },
      { action: "Pilot with 200 sole proprietors", owner: "Product team", by: "31 Jan 2027" },
    ],
  },
};

/* ------------------------------------------------------------------ Market update */
const market: Design = {
  id: "market", name: "Market update", blurb: "Weekly markets and economics", palette: [INK, RED, MIST],
  slides: [
    { bg: INK, els: [
      shape(0.9, 1.2, 0.5, 0.07, RED),
      label(0.9, 1.45, 8, "MARKET UPDATE", "FFFFFF"),
      text(0.9, 2.1, 10.5, 2.6, "{{update_title}}", { sz: 44, b: true, color: "FFFFFF", font: SANS }, { anchor: "b" }),
      text(0.9, 4.95, 10, 0.5, "As of {{as_of}}", { sz: 18, color: "B4B4BA", font: SANS }),
      text(0.9, 6.5, 10, 0.4, "{{desk}}", { sz: 12, color: "8E8E95", font: SANS }),
    ] },
    { bg: "FFFFFF", els: [
      ...frame("Markets at a glance", "Market update  |  For internal discussion only"),
      table(0.9, 1.8, 7.4, "indicators", { rows: 5, head, body, band: "FAFAFA", rowH: 0.8, headH: 0.5,
        cols: [{ key: "name", label: "Indicator", w: 2.6 }, { key: "level", label: "Level", w: 1.3 }, { key: "change", label: "Week", w: 1.1 }, { key: "signal", label: "Signal", w: 1.3 }] }),
      shape(8.8, 1.8, 3.63, 4.8, MIST),
      label(9.1, 2.1, 3, "OUR TAKE"),
      text(9.1, 2.65, 3.05, 3.8, "{{house_view}}", { sz: 16, color: INK, font: SANS, line: 1.15 }),
    ] },
    { bg: "FFFFFF", els: [
      ...frame("What to watch", "Market update  |  For internal discussion only"),
      label(0.9, 1.8, 5, "THEMES", INK),
      text(0.9, 2.35, 5.6, 4.3, "{{themes}}", { sz: 17, color: INK, font: SANS, bullet: true, after: 12 }),
      label(7, 1.8, 5, "COMING UP", INK),
      table(7, 2.3, 5.43, "events", { rows: 4, head, body, band: "FAFAFA", rowH: 0.85, headH: 0.5,
        cols: [{ key: "date", label: "Date", w: 1.3 }, { key: "event", label: "Event", w: 4 }] }),
    ] },
  ],
  project: {
    settings: {
      file_name_field: "update_title",
      colour_rules: [{ match: "Positive", fill: "D9F2E3", text: "1E7A46" }, { match: "Neutral", fill: "EDEDEF", text: "4A4A50" }, { match: "Negative", fill: "FADBD8", text: "A93226" }],
    },
    fields: {
      update_title: { desc: "Headline of the week, as a statement", max: 10, example: "Rates on hold, Asian equities lead" },
      as_of: { desc: "Date and time the data was taken", example: "17 October 2026, 5 pm SGT" },
      desk: { desc: "Team that wrote the update", example: "Group Research, Macro and FX" },
      "indicators[]": { desc: "most important first" },
      "indicators[].name": { desc: "Market or economic indicator", max: 4, example: "Straits Times Index\nUSD/SGD\nUS 10-year yield\nBrent crude\nGold" },
      "indicators[].level": { desc: "Latest level, with unit", max: 2, example: "3,912\n1.3045\n4.12%\n$78.40\n$2,610" },
      "indicators[].change": { desc: "Change on the week, with sign", max: 2, example: "+1.8%\n-0.4%\n-6 bp\n+2.1%\n+0.6%" },
      "indicators[].signal": { desc: "What the move means for clients", allowed: "Positive, Neutral, Negative", example: "Positive\nNeutral\nPositive\nNegative\nNeutral" },
      house_view: { desc: "The team's view in a few sentences", max: 55, example: "The Fed pause and a softer dollar are helping Asian markets. We stay overweight Singapore banks and REITs, but higher oil is a risk to the inflation outlook into year end." },
      themes: { type: "list", desc: "Themes to watch in the coming weeks", max: 14, example: "Whether the Fed signals a December cut\nChina stimulus details after the plenum\nOil supply as winter demand picks up\nQ3 results from Singapore banks" },
      "events[]": { desc: "in date order" },
      "events[].date": { desc: "Date of the event", example: "22 Oct\n29 Oct\n5 Nov" },
      "events[].event": { desc: "What happens", max: 10, example: "Singapore September inflation data\nFOMC rate decision\nUS presidential debate fallout on markets" },
    },
  },
  test: {
    update_title: "Rates on hold, Asian equities lead", as_of: "17 October 2026, 5 pm SGT", desk: "Group Research, Macro and FX",
    indicators: [
      { name: "Straits Times Index", level: "3,912", change: "+1.8%", signal: "Positive" },
      { name: "USD/SGD", level: "1.3045", change: "-0.4%", signal: "Neutral" },
      { name: "US 10-year yield", level: "4.12%", change: "-6 bp", signal: "Positive" },
      { name: "Brent crude", level: "$78.40", change: "+2.1%", signal: "Negative" },
      { name: "Gold", level: "$2,610", change: "+0.6%", signal: "Neutral" },
    ],
    house_view: "The Fed pause and a softer dollar are helping Asian markets. We stay overweight Singapore banks and REITs, but higher oil is a risk to the inflation outlook into year end.",
    themes: ["Whether the Fed signals a December cut", "China stimulus details after the plenum", "Oil supply as winter demand picks up", "Q3 results from Singapore banks"],
    events: [
      { date: "22 Oct", event: "Singapore September inflation data" },
      { date: "29 Oct", event: "FOMC rate decision" },
      { date: "5 Nov", event: "US presidential debate fallout on markets" },
    ],
  },
};

/* ------------------------------------------------------------------ Client brief */
const client: Design = {
  id: "client", name: "Client brief", blurb: "Meeting prep for relationship managers", palette: [RED, INK, MIST],
  slides: [
    { bg: "FFFFFF", els: [
      shape(0, 0, 13.333, 0.14, RED),
      label(0.9, 1.2, 8, "CLIENT BRIEF"),
      text(0.9, 1.8, 11, 2.2, "{{client_name}}", { sz: 48, b: true, color: INK, font: SANS }, { anchor: "b" }),
      text(0.9, 4.2, 11, 0.9, "{{meeting_purpose}}", { sz: 22, color: INK, font: SANS }),
      shape(0.9, 5.4, 11.53, 0.01, RULE),
      text(0.9, 5.6, 5, 0.9, [{ text: "Meeting", sz: 12, color: GREY, font: SANS }, { text: "{{meeting_date}}", sz: 16, b: true, color: INK, font: SANS }]),
      text(6.2, 5.6, 6, 0.9, [{ text: "Relationship manager", sz: 12, color: GREY, font: SANS }, { text: "{{relationship_manager}}", sz: 16, b: true, color: INK, font: SANS }]),
    ] },
    { bg: "FFFFFF", els: [
      ...frame("Client at a glance", "Client brief  |  Confidential"),
      fact(0.9, 1.8, 2.7, "segment", "Segment"), fact(3.84, 1.8, 2.7, "client_since", "Client since"),
      fact(6.78, 1.8, 2.7, "total_relationship", "Total relationship"), fact(9.72, 1.8, 2.71, "products_held", "Products held"),
      label(0.9, 3.75, 5, "BACKGROUND", INK),
      text(0.9, 4.2, 11.5, 2.5, "{{background}}", { sz: 18, color: INK, font: SANS, line: 1.15 }),
    ] },
    { bg: "FFFFFF", els: [
      ...frame("For this meeting", "Client brief  |  Confidential"),
      label(0.9, 1.8, 5, "OBJECTIVES", INK),
      text(0.9, 2.35, 5, 2.6, "{{objectives}}", { sz: 16, color: INK, font: SANS, bullet: true, after: 10 }),
      text(0.9, 5.1, 5, 1.55, [{ text: "Watch-outs", sz: 13, b: true, color: RED, font: SANS, after: 4 }, { text: "{{watch_outs}}", sz: 14, color: INK, font: SANS }],
        {}, { fill: "FDF1F2", ins: 0.2 }),
      label(6.4, 1.8, 5, "OPPORTUNITIES", INK),
      table(6.4, 2.3, 6.03, "opportunities", { rows: 4, head, body, band: "FAFAFA", rowH: 0.95, headH: 0.5,
        cols: [{ key: "product", label: "Product", w: 2.6 }, { key: "size", label: "Potential", w: 1.3 }, { key: "priority", label: "Priority", w: 1.1 }] }),
    ] },
  ],
  project: {
    settings: { file_name_field: "client_name", colour_rules: RAG },
    fields: {
      client_name: { desc: "Client's company name", max: 6, example: "Harbourline Logistics Pte Ltd" },
      meeting_purpose: { desc: "Why we are meeting, in one sentence", max: 18, example: "Annual review and discussion of their Vietnam expansion financing" },
      meeting_date: { desc: "Date and place of the meeting", example: "24 Oct 2026, client office" },
      relationship_manager: { desc: "Relationship manager's name", example: "Daniel Lim" },
      segment: { desc: "Client segment", max: 3, example: "Mid-market" },
      client_since: { desc: "Year the relationship began", example: "2014" },
      total_relationship: { desc: "Total balances and limits, short form", max: 2, example: "$46m" },
      products_held: { desc: "Number of products held", max: 2, example: "7" },
      background: { desc: "Who the client is and how the relationship stands", max: 70, example: "Family-owned freight forwarder with 320 staff and revenue of $210m. Strong cash management user with us; trade financing is split with two other banks. The second-generation CFO joined last year and is reviewing all banking partners." },
      objectives: { type: "list", desc: "What we want from the meeting", max: 12, example: "Understand timing and size of the Vietnam warehouse build\nPosition our green loan for the new facility\nAgree a date for the CFO to meet our trade team" },
      watch_outs: { desc: "Sensitivities or open complaints to be aware of", max: 30, example: "A delayed FX settlement in August was escalated to the CEO. Acknowledge it early and confirm the fix." },
      "opportunities[]": { desc: "largest first" },
      "opportunities[].product": { desc: "Product or service", max: 5, example: "Green term loan\nTrade finance line\nFX hedging" },
      "opportunities[].size": { desc: "Potential size, short form", max: 2, example: "$25m\n$10m\n$3m" },
      "opportunities[].priority": { desc: "Priority", allowed: "High, Medium, Low", example: "High\nMedium\nLow" },
    },
  },
  test: {
    client_name: "Harbourline Logistics Pte Ltd", meeting_purpose: "Annual review and discussion of their Vietnam expansion financing",
    meeting_date: "24 Oct 2026, client office", relationship_manager: "Daniel Lim",
    segment: "Mid-market", client_since: "2014", total_relationship: "$46m", products_held: "7",
    background: "Family-owned freight forwarder with 320 staff and revenue of $210m. Strong cash management user with us; trade financing is split with two other banks. The second-generation CFO joined last year and is reviewing all banking partners.",
    objectives: ["Understand timing and size of the Vietnam warehouse build", "Position our green loan for the new facility", "Agree a date for the CFO to meet our trade team"],
    watch_outs: "A delayed FX settlement in August was escalated to the CEO. Acknowledge it early and confirm the fix.",
    opportunities: [
      { product: "Green term loan", size: "$25m", priority: "High" },
      { product: "Trade finance line", size: "$10m", priority: "Medium" },
      { product: "FX hedging", size: "$3m", priority: "Low" },
    ],
  },
};

/* ------------------------------------------------------------------ Approval paper */
const approval: Design = {
  id: "approval", name: "Approval paper", blurb: "Papers for committee approval", palette: [INK, RED, MIST],
  slides: [
    { bg: "FFFFFF", els: [
      shape(0, 0, 5.6, 7.5, INK),
      shape(0.9, 1.2, 0.5, 0.07, RED),
      label(0.9, 1.45, 4.3, "PAPER FOR APPROVAL", "FFFFFF"),
      text(0.9, 2.1, 4.2, 3.6, "{{paper_title}}", { sz: 36, b: true, color: "FFFFFF", font: SANS }, { anchor: "b" }),
      text(0.9, 6.3, 4.3, 0.5, "{{paper_date}}", { sz: 14, color: "B4B4BA", font: SANS }),
      label(6.4, 1.2, 6, "DECISION REQUIRED"),
      text(6.4, 1.7, 6, 2.2, "{{decision_required}}", { sz: 22, b: true, color: INK, font: SANS, line: 1.1 }),
      shape(6.4, 4.3, 6.03, 0.01, RULE),
      text(6.4, 4.5, 6, 0.9, [{ text: "Committee", sz: 12, color: GREY, font: SANS }, { text: "{{committee}}", sz: 16, b: true, color: INK, font: SANS }]),
      text(6.4, 5.5, 6, 0.9, [{ text: "Sponsor", sz: 12, color: GREY, font: SANS }, { text: "{{sponsor}}", sz: 16, b: true, color: INK, font: SANS }]),
    ] },
    { bg: "FFFFFF", els: [
      ...frame("The proposal", "Paper for approval  |  Restricted"),
      label(0.9, 1.8, 5, "BACKGROUND", INK),
      text(0.9, 2.3, 5.6, 2.3, "{{background}}", { sz: 16, color: INK, font: SANS, line: 1.15 }),
      shape(7, 1.8, 5.43, 2.85, MIST),
      label(7.3, 2.05, 5, "WHAT WE PROPOSE"),
      text(7.3, 2.55, 4.85, 2, "{{proposal}}", { sz: 15, color: INK, font: SANS, bullet: true, after: 8 }),
      fact(0.9, 5, 3.6, "cost", "One-off cost"), fact(4.87, 5, 3.6, "benefit", "Annual benefit"), fact(8.83, 5, 3.6, "payback", "Payback"),
    ] },
    { bg: "FFFFFF", els: [
      ...frame("Risks and recommendation", "Paper for approval  |  Restricted"),
      table(0.9, 1.8, 7.2, "risks", { rows: 4, head, body, band: "FAFAFA", rowH: 1.05, headH: 0.5,
        cols: [{ key: "risk", label: "Risk", w: 2.8 }, { key: "rating", label: "Rating", w: 1.1 }, { key: "mitigation", label: "Mitigation", w: 3.3 }] }),
      text(8.6, 1.8, 3.83, 4.8, [{ text: "Recommendation", sz: 13, b: true, color: "FFFFFF", font: SANS, after: 8 }, { text: "{{recommendation}}", sz: 18, color: "FFFFFF", font: SANS, line: 1.1 }],
        {}, { fill: RED, ins: 0.3 }),
    ] },
  ],
  project: {
    settings: { file_name_field: "paper_title", colour_rules: RAG },
    fields: {
      paper_title: { desc: "Title of the paper", max: 10, example: "Replace the branch queue system across 18 branches" },
      paper_date: { desc: "Date of the paper", example: "19 October 2026" },
      decision_required: { desc: "Exactly what the committee is asked to approve", max: 30, example: "Approve $2.4m capital spend to replace the branch queue system, with roll-out from March 2027." },
      committee: { desc: "Committee the paper goes to", example: "Group Investment Committee" },
      sponsor: { desc: "Executive sponsor and role", example: "Michelle Ong, Head of Branch Network" },
      background: { desc: "Why this is needed now", max: 50, example: "The current queue system is out of vendor support from June 2027. It fails about twice a month, and customers cannot book branch visits ahead, which is the top complaint in branch surveys." },
      proposal: { type: "list", desc: "What will be done", max: 12, example: "Replace hardware and software in 18 branches\nAdd appointment booking in the mobile app\nRoll out in three waves from March 2027" },
      cost: { desc: "One-off cost, short form", max: 2, example: "$2.4m" },
      benefit: { desc: "Yearly benefit, short form", max: 2, example: "$0.9m" },
      payback: { desc: "Time to pay back the cost", max: 3, example: "2.7 years" },
      "risks[]": { desc: "highest rating first" },
      "risks[].risk": { desc: "What could go wrong", max: 10, example: "Roll-out disrupts busy branches\nApp booking adoption is low\nVendor delivery slips" },
      "risks[].rating": { desc: "Rating", allowed: "High, Medium, Low", example: "High\nMedium\nLow" },
      "risks[].mitigation": { desc: "How the risk is handled", max: 12, example: "Install over weekends, one wave at a time\nPromote booking through branch staff and app banners\nPenalty clauses and a fixed delivery plan" },
      recommendation: { desc: "The recommendation to the committee", max: 40, example: "Approve the $2.4m spend. Waiting past June 2027 leaves branches on an unsupported system, and the booking feature answers our top customer complaint." },
    },
  },
  test: {
    paper_title: "Replace the branch queue system across 18 branches", paper_date: "19 October 2026",
    decision_required: "Approve $2.4m capital spend to replace the branch queue system, with roll-out from March 2027.",
    committee: "Group Investment Committee", sponsor: "Michelle Ong, Head of Branch Network",
    background: "The current queue system is out of vendor support from June 2027. It fails about twice a month, and customers cannot book branch visits ahead, which is the top complaint in branch surveys.",
    proposal: ["Replace hardware and software in 18 branches", "Add appointment booking in the mobile app", "Roll out in three waves from March 2027"],
    cost: "$2.4m", benefit: "$0.9m", payback: "2.7 years",
    risks: [
      { risk: "Roll-out disrupts busy branches", rating: "High", mitigation: "Install over weekends, one wave at a time" },
      { risk: "App booking adoption is low", rating: "Medium", mitigation: "Promote booking through branch staff and app banners" },
      { risk: "Vendor delivery slips", rating: "Low", mitigation: "Penalty clauses and a fixed delivery plan" },
    ],
    recommendation: "Approve the $2.4m spend. Waiting past June 2027 leaves branches on an unsupported system, and the booking feature answers our top customer complaint.",
  },
};

export const BRIEFS: Design[] = [brief, market, client, approval];
