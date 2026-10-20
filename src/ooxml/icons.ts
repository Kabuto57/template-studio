// A small built-in icon set, drawn as 24 x 24 line icons. Inserted into a slide as a PNG in the
// chosen colour, so it looks the same in every version of PowerPoint.
export interface IconDef { id: string; label: string; svg: string }

const I = (id: string, label: string, svg: string): IconDef => ({ id, label, svg });
export const ICONS: IconDef[] = [
  I("bank", "Bank", '<path d="M3 9.5 12 4l9 5.5M4.5 10v8M9 10v8M15 10v8M19.5 10v8M3 20h18"/>'),
  I("coin", "Money", '<circle cx="12" cy="12" r="8.5"/><path d="M14.5 9.2c-.5-.9-1.5-1.4-2.6-1.4-1.6 0-2.7.8-2.7 2s1.1 1.7 2.8 2.1c1.8.4 2.9 1 2.9 2.2s-1.2 2.1-2.9 2.1c-1.2 0-2.3-.6-2.8-1.5M12 6.2v1.6M12 16.2v1.6"/>'),
  I("card", "Card", '<rect x="3" y="5.5" width="18" height="13" rx="2"/><path d="M3 10h18M7 15h3"/>'),
  I("wallet", "Wallet", '<path d="M4 7.5h14a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a1 1 0 0 1-1-1V6a1.5 1.5 0 0 1 1.5-1.5H16"/><circle cx="16" cy="13.5" r="1.2"/>'),
  I("chart-bar", "Bar chart", '<path d="M4 20h16M7 16v-5M12 16V6M17 16v-8"/>'),
  I("chart-line", "Line chart", '<path d="M4 20h16M4 4v16"/><path d="m7 15 4-4 3 3 5-6"/>'),
  I("chart-pie", "Pie chart", '<path d="M12 3.5v8.5h8.5A8.5 8.5 0 1 1 12 3.5Z"/><path d="M15 3.8A8.5 8.5 0 0 1 20.2 9H15Z"/>'),
  I("up", "Growth", '<path d="m4 17 6-6 4 4 6-7"/><path d="M15 8h5v5"/>'),
  I("down", "Decline", '<path d="m4 7 6 6 4-4 6 7"/><path d="M15 16h5v-5"/>'),
  I("target", "Target", '<circle cx="12" cy="12" r="8.5"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1.5"/>'),
  I("users", "People", '<circle cx="9" cy="8.5" r="3.2"/><path d="M3.5 19c.6-3 2.8-4.8 5.5-4.8s4.9 1.8 5.5 4.8"/><circle cx="16.5" cy="9.5" r="2.6"/><path d="M15.5 14.4c2.4-.2 4.4 1.3 5 4.1"/>'),
  I("user", "Person", '<circle cx="12" cy="8" r="3.8"/><path d="M4.5 20c.8-3.8 3.7-6 7.5-6s6.7 2.2 7.5 6"/>'),
  I("briefcase", "Business", '<rect x="3" y="7.5" width="18" height="12" rx="2"/><path d="M9 7.5V5.5a1.5 1.5 0 0 1 1.5-1.5h3A1.5 1.5 0 0 1 15 5.5v2M3 12.5h18"/>'),
  I("building", "Office", '<rect x="5" y="3.5" width="14" height="17" rx="1"/><path d="M9 7.5h1M14 7.5h1M9 11h1M14 11h1M9 14.5h1M14 14.5h1M10.5 20.5v-3h3v3"/>'),
  I("home", "Home", '<path d="M4 11 12 4l8 7M6 9.5V20h12V9.5M10 20v-5h4v5"/>'),
  I("globe", "Global", '<circle cx="12" cy="12" r="8.5"/><path d="M3.5 12h17M12 3.5c2.4 2.4 3.5 5.2 3.5 8.5s-1.1 6.1-3.5 8.5c-2.4-2.4-3.5-5.2-3.5-8.5S9.6 5.9 12 3.5Z"/>'),
  I("pin", "Location", '<path d="M12 21s-6.5-6-6.5-11a6.5 6.5 0 0 1 13 0c0 5-6.5 11-6.5 11Z"/><circle cx="12" cy="10" r="2.3"/>'),
  I("shield", "Security", '<path d="M12 3.5 19 6v5.5c0 4.5-3 7.6-7 9-4-1.4-7-4.5-7-9V6Z"/><path d="m9 12 2 2 4-4"/>'),
  I("lock", "Locked", '<rect x="5" y="10.5" width="14" height="10" rx="2"/><path d="M8 10.5V8a4 4 0 0 1 8 0v2.5M12 14.5v2"/>'),
  I("check", "Done", '<circle cx="12" cy="12" r="8.5"/><path d="m8 12.3 2.8 2.7L16 9.5"/>'),
  I("cross", "Stop", '<circle cx="12" cy="12" r="8.5"/><path d="m9 9 6 6M15 9l-6 6"/>'),
  I("alert", "Warning", '<path d="M12 4 21 19.5H3Z"/><path d="M12 10v4M12 16.8v.2"/>'),
  I("info", "Information", '<circle cx="12" cy="12" r="8.5"/><path d="M12 11v5.5M12 7.8v.2"/>'),
  I("bulb", "Idea", '<path d="M9 17.5h6M10 20.5h4M12 3.5a6 6 0 0 0-3.5 10.9c.6.5 1 1.2 1 2V17.5h5v-1.1c0-.8.4-1.5 1-2A6 6 0 0 0 12 3.5Z"/>'),
  I("rocket", "Launch", '<path d="M12 15c-1.5-1.5-2.5-3-3-4.5C10.5 6 13.5 3.8 19.5 4.5c.7 6-1.5 9-6 10.5-.5-.5-1-.5-1.5 0Z"/><path d="M9 10.5 5.5 11 4 14l4 .5M13.5 15l-.5 3.5-3 1.5-.5-4"/><circle cx="15" cy="9" r="1.3"/>'),
  I("flag", "Milestone", '<path d="M5.5 21V4M5.5 4.5h12l-2.5 4 2.5 4h-12"/>'),
  I("calendar", "Date", '<rect x="3.5" y="5" width="17" height="15" rx="2"/><path d="M3.5 10h17M8 3v4M16 3v4"/>'),
  I("clock", "Time", '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>'),
  I("doc", "Document", '<path d="M6 3.5h8l4 4V20a.5.5 0 0 1-.5.5h-11A.5.5 0 0 1 6 20Z"/><path d="M14 3.5V8h4M9 12h6M9 15.5h6"/>'),
  I("search", "Search", '<circle cx="10.5" cy="10.5" r="6"/><path d="m15 15 5 5"/>'),
  I("mail", "Email", '<rect x="3" y="5.5" width="18" height="13" rx="2"/><path d="m3.5 6.5 8.5 6.5 8.5-6.5"/>'),
  I("phone", "Phone", '<rect x="7" y="2.5" width="10" height="19" rx="2"/><path d="M11 18.5h2"/>'),
  I("chat", "Conversation", '<path d="M4 5.5h16v10H9.5L5 19.5v-4H4Z"/>'),
  I("leaf", "Sustainable", '<path d="M5 19c0-8 4.5-13.5 14.5-14.5C19.5 14 14 19 5 19Z"/><path d="M5 19c3-4 6-6.5 9.5-8.5"/>'),
  I("star", "Highlight", '<path d="m12 3.5 2.6 5.5 6 .7-4.4 4.1 1.2 6L12 16.8 6.6 19.8l1.2-6-4.4-4.1 6-.7Z"/>'),
  I("gear", "Process", '<circle cx="12" cy="12" r="3"/><path d="M12 3.5v2.3M12 18.2v2.3M3.5 12h2.3M18.2 12h2.3M6 6l1.6 1.6M16.4 16.4 18 18M6 18l1.6-1.6M16.4 7.6 18 6"/>'),
  I("handshake", "Partnership", '<path d="m3 11 4-4 3 1.5 3-1.5 4 1 4 3M3 11l5.5 5.5a1.5 1.5 0 0 0 2 0l.5-.5M21 11l-6 6.5a1.5 1.5 0 0 1-2 0L8.5 13l2.5-2.5 2.5 1"/>'),
  I("arrow", "Next", '<circle cx="12" cy="12" r="8.5"/><path d="M8 12h8M13 9l3 3-3 3"/>'),
];

/** The SVG markup for an icon in a colour (hex without #), at a pixel size. */
export const iconSvg = (icon: IconDef, colour = "currentColor", px = 24): string =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="${px}" height="${px}" fill="none" stroke="${colour === "currentColor" ? colour : "#" + colour}" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${icon.svg}</svg>`;
