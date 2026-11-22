import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pptxgen from "pptxgenjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const EXEC_DIR = path.resolve(HERE, "..");
const EXPORTS = path.join(EXEC_DIR, "exports");
const HIGH_LEVEL = path.join(EXPORTS, "01-high-level.png");
const MID_LEVEL = path.join(EXPORTS, "02-mid-level.png");
const OUTPUT = path.join(EXPORTS, "Storage-Host-Executive-Update-2026-11-22.pptx");

const REVIEW_DATE = "22 November 2026";
const FOOTER = `Storage Host Platform  ·  Executive Update  ·  ${REVIEW_DATE}`;

const C = {
  navy: "0B1F33",
  ink: "0F172A",
  slate: "475569",
  muted: "64748B",
  line: "CBD5E1",
  paper: "F8FAFC",
  white: "FFFFFF",
  teal: "0F766E",
  tealDark: "134E4A",
  tealLight: "E6F4F1",
  blue: "1D4ED8",
  blueLight: "EFF6FF",
  amber: "B45309",
  amberLight: "FFFBEB",
  red: "B91C1C",
  redLight: "FEF2F2",
  green: "15803D",
  greenLight: "F0FDF4",
  purple: "7C3AED",
  purpleLight: "F5F3FF",
};

const FONT = "Arial";

for (const file of [HIGH_LEVEL, MID_LEVEL]) {
  if (!fs.existsSync(file)) {
    throw new Error(`Missing diagram export: ${file}\nRun ../../build.sh first.`);
  }
}

function pngSize(file) {
  const buffer = fs.readFileSync(file);
  if (buffer.toString("ascii", 1, 4) !== "PNG") {
    throw new Error(`Not a PNG file: ${file}`);
  }
  return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
}

const highSize = pngSize(HIGH_LEVEL);
const midSize = pngSize(MID_LEVEL);

const pptx = new pptxgen();
pptx.layout = "LAYOUT_WIDE";
pptx.author = "Storage Host Maintainers";
pptx.company = "Storage Host";
pptx.subject = "Executive update on the private AlmaLinux 10 storage platform";
pptx.title = "Storage Host Platform — Executive Update";
pptx.lang = "en-US";
pptx.theme = {
  headFontFace: FONT,
  bodyFontFace: FONT,
  lang: "en-US",
};
pptx.defineLayout({ name: "EXEC_WIDE", width: 13.333, height: 7.5 });
pptx.layout = "EXEC_WIDE";

const W = 13.333;
const H = 7.5;
const MX = 0.62;

function addRect(slide, x, y, w, h, fill, line = null, radius = 0.08, transparency = 0) {
  const options = {
    x,
    y,
    w,
    h,
    rectRadius: radius,
    fill: { color: fill, transparency },
    line: line
      ? { color: line.color, width: line.width ?? 0.75, transparency: line.transparency ?? 0 }
      : { color: fill, transparency: 100 },
  };
  slide.addShape(pptx.ShapeType.roundRect, options);
}

function addLine(slide, x, y, w, h, color, width = 0.75, dash = "solid") {
  slide.addShape(pptx.ShapeType.line, {
    x,
    y,
    w,
    h,
    line: { color, width, dashType: dash },
  });
}

function addText(slide, text, x, y, w, h, opts = {}) {
  slide.addText(text, {
    x,
    y,
    w,
    h,
    fontFace: opts.fontFace ?? FONT,
    fontSize: opts.fontSize ?? 12,
    color: opts.color ?? C.ink,
    bold: opts.bold ?? false,
    italic: opts.italic ?? false,
    align: opts.align ?? "left",
    valign: opts.valign ?? "top",
    margin: opts.margin ?? 0,
    breakLine: false,
    fit: opts.fit ?? "shrink",
    lineSpacingMultiple: opts.lineSpacingMultiple ?? 1.0,
    charSpacing: opts.charSpacing,
    isTextBox: true,
    ...opts.extra,
  });
}

function addChip(slide, text, x, y, w, h, fill, color, border = null, fontSize = 9.5, bold = true) {
  addRect(slide, x, y, w, h, fill, border, h / 2);
  addText(slide, text, x + 0.08, y + 0.02, w - 0.16, h - 0.04, {
    fontSize,
    bold,
    color,
    align: "center",
    valign: "mid",
  });
}

function addFooter(slide, page) {
  addLine(slide, MX, 7.03, W - MX * 2, 0, C.line, 0.6);
  addText(slide, FOOTER, MX, 7.12, 8.8, 0.2, {
    fontSize: 8,
    color: C.muted,
  });
  addText(slide, "Internal · Private infrastructure", W - MX - 3.35, 7.12, 2.55, 0.2, {
    fontSize: 8,
    color: C.muted,
    align: "right",
  });
  addText(slide, String(page).padStart(2, "0"), W - MX - 0.45, 7.12, 0.45, 0.2, {
    fontSize: 8,
    bold: true,
    color: C.slate,
    align: "right",
  });
}

function addHeader(slide, kicker, title, subtitle = null) {
  addText(slide, kicker.toUpperCase(), MX, 0.43, 7.4, 0.24, {
    fontSize: 9.5,
    bold: true,
    color: C.teal,
    charSpacing: 1.4,
  });
  addText(slide, title, MX, 0.69, W - MX * 2 - 0.1, 0.82, {
    fontSize: 25,
    bold: true,
    color: C.navy,
    valign: "top",
    lineSpacingMultiple: 1.05,
  });
  if (subtitle) {
    addText(slide, subtitle, MX, 1.43, W - MX * 2, 0.35, {
      fontSize: 11.5,
      color: C.slate,
      valign: "top",
    });
  }
  addText(slide, "INTERNAL", W - MX - 1.0, 0.44, 1.0, 0.2, {
    fontSize: 8,
    bold: true,
    color: C.muted,
    align: "right",
    charSpacing: 1.2,
  });
}

function addImageContain(slide, file, x, y, w, h, altText) {
  const size = file === HIGH_LEVEL ? highSize : midSize;
  const scale = Math.min(w / size.width, h / size.height);
  const iw = size.width * scale;
  const ih = size.height * scale;
  slide.addImage({
    path: file,
    x: x + (w - iw) / 2,
    y: y + (h - ih) / 2,
    w: iw,
    h: ih,
    altText,
  });
}

function addBullet(slide, text, x, y, w, h, opts = {}) {
  addText(slide, text, x, y, w, h, {
    fontSize: opts.fontSize ?? 11,
    color: opts.color ?? C.slate,
    bold: opts.bold ?? false,
    valign: "top",
    fit: "shrink",
    lineSpacingMultiple: 1.08,
  });
}

function addNumberBadge(slide, number, x, y, d, fill, color = C.white) {
  slide.addShape(pptx.ShapeType.ellipse, {
    x,
    y,
    w: d,
    h: d,
    fill: { color: fill },
    line: { color: fill, width: 0.5 },
  });
  addText(slide, number, x, y + 0.005, d, d - 0.01, {
    fontSize: d > 0.34 ? 12 : 10,
    bold: true,
    color,
    align: "center",
    valign: "mid",
    margin: 0,
  });
}

// ---------------------------------------------------------------------------
// Slide 1 — Title
// ---------------------------------------------------------------------------
{
  const slide = pptx.addSlide();
  slide.background = { color: C.navy };

  // Subtle framing.
  addRect(slide, 0, 0, W, 0.09, C.teal, null, 0);
  addRect(slide, 0.62, 1.35, 0.045, 3.3, C.teal, null, 0);

  addText(slide, "STORAGE HOST PLATFORM", 0.92, 0.78, 6.2, 0.28, {
    fontSize: 10,
    bold: true,
    color: "8FD3C8",
    charSpacing: 1.8,
  });
  addText(slide, "EXECUTIVE UPDATE  ·  22 NOVEMBER 2026", 0.92, 1.42, 8.6, 0.28, {
    fontSize: 10,
    bold: true,
    color: "C7D2E0",
    charSpacing: 1.2,
  });
  addText(slide, "Build complete.\nProduction readiness gated.", 0.92, 1.86, 10.8, 1.9, {
    fontSize: 38,
    bold: true,
    color: C.white,
    lineSpacingMultiple: 1.04,
    valign: "top",
  });
  addText(
    slide,
    "A private AlmaLinux 10 platform for search, relational data, and S3-compatible object storage.",
    0.94,
    4.08,
    9.2,
    0.62,
    {
      fontSize: 14,
      color: "C7D2E0",
      lineSpacingMultiple: 1.15,
    },
  );

  const stats = [
    ["6", "roles implemented"],
    ["7", "components pinned"],
    ["130", "files linted · 0 failures"],
  ];
  stats.forEach(([value, label], index) => {
    const x = 0.94 + index * 3.1;
    addText(slide, value, x, 5.45, 1.0, 0.55, {
      fontSize: 26,
      bold: true,
      color: C.white,
    });
    addText(slide, label, x + 1.02, 5.52, 2.0, 0.34, {
      fontSize: 10,
      color: "9FB0C4",
      bold: true,
    });
  });

  addText(slide, "Private / VPN access only  ·  No public ingress", W - 4.35, 6.48, 3.7, 0.25, {
    fontSize: 9,
    color: "8FD3C8",
    align: "right",
    bold: true,
  });

  slide.addNotes(
    [
      "Purpose: give executives a quick, accurate read on the platform and the decision required.",
      "The build is complete at the code and configuration level; production readiness is intentionally gated on real-host validation, off-host recovery, and operational visibility.",
      "The platform is private by design. The only HTTP front door is NGINX on 443, restricted to approved private or VPN CIDRs.",
    ].join("\n\n"),
  );
}

// ---------------------------------------------------------------------------
// Slide 2 — Executive summary
// ---------------------------------------------------------------------------
{
  const slide = pptx.addSlide();
  addHeader(slide, "Executive summary", "The platform is built; production is not yet proven.");

  const chips = [
    ["BUILD", "Complete", C.green, C.greenLight],
    ["VALIDATION", "Partial", C.amber, C.amberLight],
    ["PRODUCTION", "Gated", C.red, C.redLight],
  ];
  chips.forEach(([label, value, color, fill], index) => {
    const x = MX + index * 2.25;
    addChip(slide, `${label}  ·  ${value}`, x, 1.55, 2.08, 0.33, fill, color, { color, width: 0.6 }, 9);
  });

  const cards = [
    {
      num: "01",
      title: "Built",
      body: "Six Ansible roles, pinned component versions, private-by-default networking, and a single deployment path for dev and prod.",
      accent: C.teal,
      fill: C.tealLight,
    },
    {
      num: "02",
      title: "Proven",
      body: "Static checks pass, real binaries were exercised, and the Garage-backed Elasticsearch snapshot flow was validated.",
      accent: C.blue,
      fill: C.blueLight,
    },
    {
      num: "03",
      title: "Gated",
      body: "Docker/CI execution, real-host certificate and SELinux checks, off-host restore, and monitoring remain before go-live.",
      accent: C.amber,
      fill: C.amberLight,
    },
  ];

  cards.forEach((card, index) => {
    const y = 2.18 + index * 1.48;
    addRect(slide, MX, y, 7.25, 1.27, C.white, { color: C.line, width: 0.7 });
    addRect(slide, MX, y, 0.07, 1.27, card.accent, null, 0);
    addText(slide, card.num, MX + 0.26, y + 0.18, 0.5, 0.25, {
      fontSize: 9,
      bold: true,
      color: card.accent,
      charSpacing: 1.2,
    });
    addText(slide, card.title, MX + 0.72, y + 0.13, 1.5, 0.3, {
      fontSize: 15,
      bold: true,
      color: C.navy,
    });
    addText(slide, card.body, MX + 0.72, y + 0.45, 6.25, 0.72, {
      fontSize: 10.5,
      color: C.slate,
      lineSpacingMultiple: 1.07,
    });
  });

  // Decision card.
  const dx = 8.2;
  addRect(slide, dx, 1.55, 4.5, 5.12, C.navy, null, 0.12);
  addRect(slide, dx, 1.55, 4.5, 0.09, C.teal, null, 0);
  addText(slide, "DECISION REQUESTED", dx + 0.34, 1.82, 3.8, 0.25, {
    fontSize: 9,
    bold: true,
    color: "8FD3C8",
    charSpacing: 1.4,
  });
  addText(slide, "Approve a focused\nreadiness sprint.", dx + 0.34, 2.12, 3.75, 0.85, {
    fontSize: 21,
    bold: true,
    color: C.white,
    lineSpacingMultiple: 1.04,
  });

  const asks = [
    "Name the production owner and go/no-go date.",
    "Provide the four production inputs and protect the age key.",
    "Choose the off-host backup target and RTO/RPO.",
    "Accept single-host v1 with monitoring as a fast-follow.",
  ];
  asks.forEach((ask, index) => {
    const y = 3.15 + index * 0.74;
    addNumberBadge(slide, String(index + 1), dx + 0.34, y + 0.02, 0.28, C.teal, C.white);
    addText(slide, ask, dx + 0.74, y - 0.01, 3.4, 0.58, {
      fontSize: 10,
      color: "DCE5EF",
      lineSpacingMultiple: 1.04,
    });
  });

  addText(slide, "Recommendation: proceed, with gates.", dx + 0.34, 6.18, 3.8, 0.22, {
    fontSize: 9,
    bold: true,
    color: "8FD3C8",
  });

  addFooter(slide, 2);
  slide.addNotes(
    [
      "Headline: the build is complete, but production is not yet proven.",
      "The green build status reflects implemented roles, pinned versions, and passing static checks. Validation is amber because Docker/Molecule and real-host checks have not run here.",
      "Production is gated on four items: production inputs, integration proof, off-host recovery, and approval.",
      "The decision requested is a time-boxed readiness sprint, not a new architecture.",
    ].join("\n\n"),
  );
}

// ---------------------------------------------------------------------------
// Slide 3 — Architecture at a glance
// ---------------------------------------------------------------------------
{
  const slide = pptx.addSlide();
  addHeader(
    slide,
    "Architecture",
    "One private host, five services, one TLS front door.",
    "The same roles and playbook order run in development and production; only inventory data and credentials differ.",
  );

  // Access column.
  addText(slide, "ACCESS", MX, 1.93, 2.5, 0.22, {
    fontSize: 8.5,
    bold: true,
    color: C.teal,
    charSpacing: 1.3,
  });
  addRect(slide, MX, 2.2, 2.55, 1.25, C.tealLight, { color: C.teal, width: 0.7 });
  addText(slide, "Private clients / VPN", MX + 0.18, 2.34, 2.2, 0.28, {
    fontSize: 12.5,
    bold: true,
    color: C.tealDark,
  });
  addText(slide, "Search · S3 · DB · operators\napproved source CIDRs only", MX + 0.18, 2.68, 2.2, 0.55, {
    fontSize: 9.5,
    color: C.tealDark,
    lineSpacingMultiple: 1.05,
  });

  addRect(slide, MX, 3.72, 2.55, 1.25, C.white, { color: C.line, width: 0.7 });
  addText(slide, "Controller / CI", MX + 0.18, 3.86, 2.2, 0.28, {
    fontSize: 12.5,
    bold: true,
    color: C.navy,
  });
  addText(slide, "Ansible · SOPS/age\nGitHub Actions (not active)", MX + 0.18, 4.2, 2.2, 0.55, {
    fontSize: 9.5,
    color: C.slate,
    lineSpacingMultiple: 1.05,
  });

  // Arrow.
  slide.addShape(pptx.ShapeType.rightArrow, {
    x: 3.36,
    y: 3.08,
    w: 0.52,
    h: 0.5,
    fill: { color: C.teal },
    line: { color: C.teal, width: 0.5 },
  });

  // Host panel.
  const hx = 4.02;
  const hw = 5.95;
  addRect(slide, hx, 1.93, hw, 4.15, C.paper, { color: C.navy, width: 1.2 }, 0.12);
  addText(slide, "storage01 · AlmaLinux 10", hx + 0.25, 2.08, 4.9, 0.32, {
    fontSize: 15,
    bold: true,
    color: C.navy,
  });
  addChip(slide, "PRIVATE / VPN CIDRs", hx + hw - 1.65, 2.11, 1.4, 0.25, C.tealLight, C.teal, { color: C.teal, width: 0.5 }, 7.5);
  addText(slide, "firewalld default-deny  ·  SELinux enforcing", hx + 0.25, 2.44, 5.2, 0.24, {
    fontSize: 9,
    color: C.muted,
  });

  // NGINX band.
  addRect(slide, hx + 0.25, 2.8, hw - 0.5, 0.78, C.teal, null, 0.08);
  addText(slide, "NGINX 1.26  ·  :443", hx + 0.47, 2.91, 2.7, 0.28, {
    fontSize: 15,
    bold: true,
    color: C.white,
  });
  addText(slide, "TLS 1.2 / 1.3  ·  httpd_t  ·  default 444", hx + 2.55, 2.97, 3.1, 0.24, {
    fontSize: 9.5,
    color: "D7F0EC",
    align: "right",
  });

  // Service cards.
  const services = [
    ["Elasticsearch", "9.5  ·  :9200", "search & analytics", C.blue, C.blueLight],
    ["Garage S3", "2.5  ·  :3900", "object storage", C.purple, C.purpleLight],
    ["PostgreSQL", "18.7  ·  :5432", "relational data", C.slate, C.white],
    ["MariaDB", "11.8.10  ·  :3306", "relational data", C.slate, C.white],
  ];
  services.forEach(([name, version, role, accent, fill], index) => {
    const col = index % 2;
    const row = Math.floor(index / 2);
    const x = hx + 0.25 + col * 2.82;
    const y = 3.78 + row * 0.92;
    addRect(slide, x, y, 2.65, 0.78, fill, { color: C.line, width: 0.6 });
    addRect(slide, x, y, 0.06, 0.78, accent, null, 0);
    addText(slide, name, x + 0.18, y + 0.1, 1.55, 0.24, {
      fontSize: 11,
      bold: true,
      color: C.navy,
    });
    addText(slide, version, x + 1.72, y + 0.1, 0.82, 0.22, {
      fontSize: 8.5,
      bold: true,
      color: accent,
      align: "right",
    });
    addText(slide, role, x + 0.18, y + 0.36, 2.25, 0.22, {
      fontSize: 8.8,
      color: C.muted,
    });
  });

  addText(slide, "Loopback-first  ·  TLS required off-host  ·  ES snapshots → Garage", hx + 0.25, 5.78, hw - 0.5, 0.24, {
    fontSize: 9,
    color: C.slate,
    align: "center",
    bold: true,
  });

  // Data column.
  addText(slide, "DATA & RECOVERY", 10.32, 1.93, 2.4, 0.22, {
    fontSize: 8.5,
    bold: true,
    color: C.amber,
    charSpacing: 1.3,
  });
  addRect(slide, 10.32, 2.2, 2.4, 1.25, C.white, { color: C.line, width: 0.7 });
  addText(slide, "Local volumes", 10.5, 2.34, 2.05, 0.26, {
    fontSize: 12,
    bold: true,
    color: C.navy,
  });
  addText(slide, "PostgreSQL · MariaDB\nGarage · Elasticsearch", 10.5, 2.66, 2.05, 0.55, {
    fontSize: 9,
    color: C.slate,
    lineSpacingMultiple: 1.05,
  });

  addRect(slide, 10.32, 3.72, 2.4, 1.25, C.amberLight, { color: C.amber, width: 0.7, transparency: 0 }, 0.08);
  addText(slide, "Off-host backup", 10.5, 3.86, 2.05, 0.26, {
    fontSize: 12,
    bold: true,
    color: C.amber,
  });
  addText(slide, "Planned\nnot yet implemented", 10.5, 4.18, 2.05, 0.5, {
    fontSize: 9,
    color: C.amber,
    lineSpacingMultiple: 1.05,
    bold: true,
  });

  const notes = [
    "Only NGINX is an HTTP front door. PostgreSQL and MariaDB remain direct TLS services and are loopback-first by default.",
    "Garage is loopback-only; NGINX provides the external S3 endpoint with path-style addressing.",
    "The single host is a deliberate v1 trade-off. Off-host backup and recovery are the largest operational gaps.",
  ];
  notes.forEach((note, index) => {
    addText(slide, `•  ${note}`, MX, 6.28 + index * 0.18, 12.0, 0.2, {
      fontSize: 8.3,
      color: C.slate,
    });
  });

  addFooter(slide, 3);
  slide.addNotes(
    [
      "This is the one-slide mental model: private clients and a controller on the left, one host in the middle, local data and recovery on the right.",
      "NGINX is the only web-facing service. It fronts Elasticsearch and Garage S3. Databases are not proxied.",
      "The host runs five services: NGINX, Elasticsearch, PostgreSQL, MariaDB, and Garage. Certbot manages certificates.",
      "The off-host backup box is intentionally dashed because it is planned, not implemented.",
    ].join("\n\n"),
  );
}

// ---------------------------------------------------------------------------
// Slide 4 — High-level diagram
// ---------------------------------------------------------------------------
{
  const slide = pptx.addSlide();
  addHeader(
    slide,
    "What talks to what  ·  high level",
    "Requests flow through NGINX; certificates and recovery are lifecycle paths.",
  );

  const imgX = MX;
  const imgY = 1.6;
  const imgW = 8.35;
  const imgH = 5.18;
  addRect(slide, imgX - 0.08, imgY - 0.08, imgW + 0.16, imgH + 0.16, C.white, { color: C.line, width: 0.7 }, 0.1);
  addImageContain(
    slide,
    HIGH_LEVEL,
    imgX,
    imgY,
    imgW,
    imgH,
    "High-level diagram: private clients and a controller talk to storage01; certificates come from Cloudflare and Let's Encrypt; off-host backup is planned.",
  );

  // Lifecycle legend.
  const lx = 9.3;
  addText(slide, "WHEN", lx, 1.62, 3.4, 0.24, {
    fontSize: 9,
    bold: true,
    color: C.teal,
    charSpacing: 1.4,
  });
  const steps = [
    ["1", "Deploy", "On commit + approval; Ansible over SSH 22.", C.blue],
    ["2", "Certificates", "First deploy, then twice daily via DNS-01.", C.amber],
    ["3–4", "Requests", "Continuous; HTTPS 443 and direct DB TLS.", C.teal],
    ["5", "Snapshots", "Elasticsearch → Garage, on demand or scheduled.", C.purple],
    ["6", "Backup", "Local today; off-host copy is planned daily.", C.muted],
  ];
  steps.forEach(([num, title, body, color], index) => {
    const y = 1.98 + index * 0.94;
    addNumberBadge(slide, num, lx, y + 0.01, 0.32, color);
    addText(slide, title, lx + 0.44, y - 0.02, 1.35, 0.24, {
      fontSize: 11.5,
      bold: true,
      color: C.navy,
    });
    addText(slide, body, lx + 0.44, y + 0.25, 3.35, 0.5, {
      fontSize: 9.2,
      color: C.slate,
      lineSpacingMultiple: 1.05,
    });
  });

  addRect(slide, lx, 6.62, 3.4, 0.3, C.paper, { color: C.line, width: 0.5 }, 0.05);
  addText(slide, "Numbers match the diagram. Private / VPN CIDRs only.", lx + 0.1, 6.68, 3.2, 0.18, {
    fontSize: 8.2,
    color: C.muted,
  });

  addFooter(slide, 4);
  slide.addNotes(
    [
      "This high-level view is deliberately four actors: private clients, the controller, storage01, and external dependencies.",
      "Flow 1 is deployment: a change is approved, Ansible connects over SSH 22, and roles run in dependency order.",
      "Flow 2 is certificate lifecycle: Certbot uses Cloudflare DNS-01, then the deploy hook reloads NGINX. This runs first deploy and twice daily.",
      "Flows 3 and 4 are continuous: search/S3 requests through NGINX on 443, and direct database TLS on 5432/3306 where explicitly allowed.",
      "Flow 5 is a local snapshot path from Elasticsearch to Garage. Flow 6 is the planned off-host backup, which is not implemented yet.",
    ].join("\n\n"),
  );
}

// ---------------------------------------------------------------------------
// Slide 5 — Mid-level diagram
// ---------------------------------------------------------------------------
{
  const slide = pptx.addSlide();
  addHeader(
    slide,
    "What talks to what  ·  mid level",
    "Ports, trust boundaries, and the paths behind the front door.",
    "Firewall → NGINX → services. Databases stay loopback-first; SELinux and TLS are part of the path.",
  );

  const imgX = 0.45;
  const imgY = 1.78;
  const imgW = 12.43;
  const imgH = 4.92;
  addRect(slide, imgX - 0.08, imgY - 0.08, imgW + 0.16, imgH + 0.16, C.white, { color: C.line, width: 0.7 }, 0.1);
  addImageContain(
    slide,
    MID_LEVEL,
    imgX,
    imgY,
    imgW,
    imgH,
    "Mid-level sequence diagram: controller deploys over SSH; clients reach NGINX on 443; NGINX proxies to Elasticsearch over verified HTTPS and Garage over loopback HTTP; databases are direct TLS; Certbot uses Cloudflare DNS-01; off-host backup is planned.",
  );

  addText(
    slide,
    "443 private/VPN only   ·   9200 / 3900 loopback   ·   httpd_t   ·   off-host backup planned",
    MX,
    6.8,
    12.0,
    0.18,
    {
      fontSize: 8.4,
      bold: true,
      color: C.slate,
      align: "center",
    },
  );

  addFooter(slide, 5);
  slide.addNotes(
    [
      "This is the detailed reference view. It is intentionally denser; the high-level slide is the executive takeaway.",
      "Trust boundary: private or VPN clients enter firewalld on 443. NGINX runs in httpd_t and terminates TLS 1.2/1.3.",
      "Elasticsearch is proxied over HTTPS on loopback with CA verification and authentication passthrough. Garage is proxied over HTTP on loopback with Host and path preserved.",
      "PostgreSQL and MariaDB are direct TLS services, loopback-first; external database access requires an explicit CIDR and listener change.",
      "Certbot uses DNS-01 through Cloudflare and a deploy hook to reload NGINX. Elasticsearch snapshots go to Garage locally; off-host backup is planned.",
      "SELinux gap: Elasticsearch and Garage have no confined domain on AlmaLinux 10 and run unconfined. This is documented and compensated by file permissions, service users, and loopback binding.",
    ].join("\n\n"),
  );
}

// ---------------------------------------------------------------------------
// Slide 6 — What is done
// ---------------------------------------------------------------------------
{
  const slide = pptx.addSlide();
  addHeader(slide, "Status  ·  done", "The build is complete and statically clean.");

  const stats = [
    ["6", "Ansible roles"],
    ["7", "components pinned"],
    ["130", "files linted · 0 failures"],
    ["6", "Molecule scenarios"],
  ];
  stats.forEach(([value, label], index) => {
    const x = MX + index * 3.05;
    addText(slide, value, x, 1.53, 1.1, 0.42, {
      fontSize: 22,
      bold: true,
      color: C.teal,
    });
    addText(slide, label, x, 1.96, 2.7, 0.22, {
      fontSize: 8.5,
      bold: true,
      color: C.muted,
    });
  });

  const cards = [
    {
      title: "Foundation",
      color: C.teal,
      fill: C.tealLight,
      bullets: [
        "Governance, architecture, variables, secrets, environments, and testing documented.",
        "SOPS/age workflow, dev/prod inventories, and pinned versions in place.",
        "Policy checks enforce no environment branching, no plaintext keys, no latest tags.",
      ],
    },
    {
      title: "Services",
      color: C.blue,
      fill: C.blueLight,
      bullets: [
        "Six roles: common, PostgreSQL 18.7, MariaDB 11.8.10, Garage 2.5.0, Elasticsearch 9.5.6, NGINX 1.26.3.",
        "Dependency-ordered site.yml and per-role playbooks.",
        "Shared Garage/Elasticsearch S3 contract; snapshot repository registered and verified.",
      ],
    },
    {
      title: "Security",
      color: C.amber,
      fill: C.amberLight,
      bullets: [
        "Private/VPN CIDRs only; port 80 closed; default TLS server returns 444.",
        "TLS end-to-end for Elasticsearch; loopback-only Garage and upstreams.",
        "SELinux enforcing, firewalld default-deny, dedicated service users, secret masking.",
      ],
    },
    {
      title: "Evidence",
      color: C.purple,
      fill: C.purpleLight,
      bullets: [
        "make lint, make syntax, policy checks, gitleaks, actionlint, shellcheck, hadolint pass.",
        "Real-binary checks: PostgreSQL, MariaDB, Garage, Elasticsearch snapshots, NGINX TLS/proxy.",
        "All six Molecule scenarios parse; full-stack integration suite is defined.",
      ],
    },
  ];

  cards.forEach((card, index) => {
    const col = index % 2;
    const row = Math.floor(index / 2);
    const x = MX + col * 6.2;
    const y = 2.4 + row * 2.18;
    addRect(slide, x, y, 5.95, 1.98, C.white, { color: C.line, width: 0.7 });
    addRect(slide, x, y, 5.95, 0.06, card.color, null, 0);
    addText(slide, card.title, x + 0.22, y + 0.18, 5.4, 0.28, {
      fontSize: 14,
      bold: true,
      color: C.navy,
    });
    card.bullets.forEach((bullet, bulletIndex) => {
      addText(slide, `•  ${bullet}`, x + 0.22, y + 0.56 + bulletIndex * 0.43, 5.5, 0.42, {
        fontSize: 9.2,
        color: C.slate,
        lineSpacingMultiple: 1.03,
      });
    });
  });

  addText(slide, "Committed locally on main. CI has not run because the repository has no remote yet.", MX, 6.78, 12.0, 0.18, {
    fontSize: 8.5,
    color: C.muted,
    italic: true,
  });

  addFooter(slide, 6);
  slide.addNotes(
    [
      "The build includes documentation, six roles, pinned versions, and a single deployment path for dev and prod.",
      "The static evidence is strong: 130 files linted with zero failures, policy checks, gitleaks, syntax, actionlint, shellcheck, and hadolint.",
      "Real binaries were exercised for each service, including the Garage-backed Elasticsearch snapshot flow and NGINX TLS/proxy routing.",
      "What is missing is execution of the Docker/Molecule integration suite and GitHub Actions, because this environment has no Docker daemon and the repository has no remote.",
    ].join("\n\n"),
  );
}

// ---------------------------------------------------------------------------
// Slide 7 — What remains
// ---------------------------------------------------------------------------
{
  const slide = pptx.addSlide();
  addHeader(
    slide,
    "Status  ·  next",
    "Four gates stand between build and production.",
    "The critical path is inputs → proof → recovery → approval. Monitoring is a fast-follow, not a launch blocker.",
  );

  const gates = [
    {
      gate: "G1",
      title: "Inputs",
      owner: "Platform + Security",
      color: C.teal,
      fill: C.tealLight,
      bullets: [
        "Add dev/prod age recipients and create secrets.",
        "Set domain, Let's Encrypt email, and private/VPN CIDRs.",
        "Supply a scoped Cloudflare DNS token.",
      ],
    },
    {
      gate: "G2",
      title: "Proof",
      owner: "Platform + CI",
      color: C.blue,
      fill: C.blueLight,
      bullets: [
        "Run Docker/Molecule and full-stack integration.",
        "Activate GitHub Actions and branch protection.",
        "Validate real-host certificate, SELinux, and firewall behavior.",
      ],
    },
    {
      gate: "G3",
      title: "Recovery",
      owner: "Operations",
      color: C.amber,
      fill: C.amberLight,
      bullets: [
        "Choose an off-host backup target.",
        "Define RTO/RPO and retention.",
        "Run a restore test, not just a backup test.",
      ],
    },
    {
      gate: "G4",
      title: "Approval",
      owner: "Change board",
      color: C.purple,
      fill: C.purpleLight,
      bullets: [
        "Review --check --diff on production.",
        "Record rollback point and maintenance window.",
        "Obtain explicit go/no-go approval.",
      ],
    },
  ];

  gates.forEach((gate, index) => {
    const x = MX + index * 3.08;
    addRect(slide, x, 1.98, 2.9, 3.85, C.white, { color: C.line, width: 0.7 });
    addRect(slide, x, 1.98, 2.9, 0.07, gate.color, null, 0);
    addNumberBadge(slide, gate.gate, x + 0.2, 2.18, 0.42, gate.color);
    addText(slide, gate.title, x + 0.72, 2.22, 1.9, 0.32, {
      fontSize: 15,
      bold: true,
      color: C.navy,
    });
    gate.bullets.forEach((bullet, bulletIndex) => {
      addText(slide, `•  ${bullet}`, x + 0.2, 2.8 + bulletIndex * 0.86, 2.5, 0.78, {
        fontSize: 9.2,
        color: C.slate,
        lineSpacingMultiple: 1.06,
      });
    });
    addText(slide, "OWNER", x + 0.2, 5.35, 1.0, 0.18, {
      fontSize: 7.2,
      bold: true,
      color: gate.color,
      charSpacing: 1.0,
    });
    addText(slide, gate.owner, x + 0.2, 5.53, 2.5, 0.18, {
      fontSize: 8.6,
      bold: true,
      color: C.slate,
    });
  });

  // Critical path strip.
  addRect(slide, MX, 6.08, 12.09, 0.64, C.navy, null, 0.08);
  addText(slide, "CRITICAL PATH", MX + 0.22, 6.22, 1.55, 0.2, {
    fontSize: 8.5,
    bold: true,
    color: "8FD3C8",
    charSpacing: 1.1,
  });
  addText(slide, "Inputs  →  Proof  →  Recovery  →  Approval", MX + 1.8, 6.15, 6.0, 0.32, {
    fontSize: 13,
    bold: true,
    color: C.white,
  });
  addText(slide, "P1 fast-follow: monitoring, runbooks, CI protection", W - MX - 4.2, 6.23, 4.0, 0.22, {
    fontSize: 8.2,
    color: "C7D2E0",
    align: "right",
  });

  addFooter(slide, 7);
  slide.addNotes(
    [
      "The four gates are sequential. Do not compress them into a single production change.",
      "G1 is inputs: age recipients, production values, and a scoped Cloudflare token. These are external dependencies.",
      "G2 is proof: run the integration suite and validate the real-host security controls that Docker cannot exercise.",
      "G3 is recovery: local backups are not disaster recovery. Define RTO/RPO and prove a restore.",
      "G4 is approval: production check diff, rollback point, maintenance window, and explicit sign-off.",
      "Monitoring is a fast-follow, but if the business cannot tolerate silent failure, promote it into G3.",
    ].join("\n\n"),
  );
}

// ---------------------------------------------------------------------------
// Slide 8 — Risks and considerations
// ---------------------------------------------------------------------------
{
  const slide = pptx.addSlide();
  addHeader(slide, "Risks & considerations", "The main risks are operational, not architectural.");

  const rows = [
    [
      { text: "Risk", options: { bold: true, color: C.white, fill: { color: C.navy } } },
      { text: "Exposure", options: { bold: true, color: C.white, fill: { color: C.navy } } },
      { text: "Mitigation / decision", options: { bold: true, color: C.white, fill: { color: C.navy } } },
    ],
    [
      { text: "Single host · no HA", options: { bold: true, color: C.navy, fill: { color: C.paper } } },
      { text: "Host loss takes down every service.", options: { color: C.slate, fill: { color: C.white } } },
      { text: "Accept for v1; define RTO/RPO. HA is a separate architecture decision.", options: { color: C.slate, fill: { color: C.white } } },
    ],
    [
      { text: "Local-only backups", options: { bold: true, color: C.navy, fill: { color: C.white } } },
      { text: "Data loss on host loss; backups share the failure domain.", options: { color: C.slate, fill: { color: C.paper } } },
      { text: "Off-host target and a tested restore before go-live.", options: { color: C.slate, fill: { color: C.paper } } },
    ],
    [
      { text: "Certificate dependency", options: { bold: true, color: C.navy, fill: { color: C.paper } } },
      { text: "Expiry or outage if Cloudflare/ACME renewal fails.", options: { color: C.slate, fill: { color: C.white } } },
      { text: "Expiry alerts, renewal dry-run, scoped token rotation.", options: { color: C.slate, fill: { color: C.white } } },
    ],
    [
      { text: "Unconfined services", options: { bold: true, color: C.navy, fill: { color: C.white } } },
      { text: "Elasticsearch and Garage have no AlmaLinux 10 confined domain.", options: { color: C.slate, fill: { color: C.paper } } },
      { text: "Compensating controls now; SELinux policy modules on the roadmap.", options: { color: C.slate, fill: { color: C.paper } } },
    ],
    [
      { text: "No monitoring", options: { bold: true, color: C.navy, fill: { color: C.paper } } },
      { text: "Outages and backup failures would be silent.", options: { color: C.slate, fill: { color: C.white } } },
      { text: "Health, certificate, backup, disk, and Elasticsearch alerts.", options: { color: C.slate, fill: { color: C.white } } },
    ],
  ];

  slide.addTable(rows, {
    x: MX,
    y: 1.62,
    w: 12.09,
    colW: [2.55, 3.55, 5.99],
    rowH: [0.4, 0.82, 0.82, 0.82, 0.82, 0.82],
    border: { type: "solid", pt: 0.6, color: C.line },
    fontFace: FONT,
    fontSize: 9.4,
    valign: "mid",
    margin: 0.08,
    autoPage: false,
  });

  addText(
    slide,
    "Open design item: confirm private DNS vs public DNS-only records for client name resolution. ACME still needs an authoritative Cloudflare zone.",
    MX,
    6.48,
    12.0,
    0.36,
    {
      fontSize: 8.8,
      color: C.amber,
      bold: true,
      lineSpacingMultiple: 1.03,
    },
  );

  addFooter(slide, 8);
  slide.addNotes(
    [
      "The architecture is sound for a private single-host v1. The risks that need executive attention are operational.",
      "Single host means no HA. That is acceptable only with explicit RTO/RPO and tested recovery.",
      "Local backups are not disaster recovery. This is the largest gap and the reason off-host backup is a go-live gate.",
      "Certificate renewal depends on Cloudflare and Let's Encrypt outbound access. It needs monitoring and a documented token rotation.",
      "Elasticsearch and Garage run unconfined under SELinux on AlmaLinux 10. Compensating controls are in place; policy modules are a future hardening step.",
      "Monitoring is not implemented. Without it, certificate and backup failures would be silent.",
      "One design item remains open: private DNS vs public DNS-only records for client resolution, while ACME uses the Cloudflare zone.",
    ].join("\n\n"),
  );
}

// ---------------------------------------------------------------------------
// Slide 9 — Decisions and 30/60/90
// ---------------------------------------------------------------------------
{
  const slide = pptx.addSlide();
  addHeader(slide, "Decisions & next steps", "Approve a focused readiness sprint; keep v1 single-host.");

  // Decisions.
  addRect(slide, MX, 1.6, 6.15, 4.75, C.white, { color: C.line, width: 0.7 });
  addText(slide, "DECISIONS REQUESTED", MX + 0.28, 1.8, 4.9, 0.22, {
    fontSize: 9,
    bold: true,
    color: C.teal,
    charSpacing: 1.3,
  });
  const decisions = [
    ["Approve the sprint", "Two weeks to close G1–G3; go/no-go at the end."],
    ["Name the backup target", "Off-host destination plus RTO/RPO and retention."],
    ["Provide production inputs", "Domain, email, CIDRs, Cloudflare token, age custody."],
    ["Confirm v1 scope", "Single host, no HA; monitoring as a fast-follow."],
  ];
  decisions.forEach(([title, body], index) => {
    const y = 2.2 + index * 0.98;
    addNumberBadge(slide, String(index + 1), MX + 0.28, y + 0.02, 0.3, C.teal);
    addText(slide, title, MX + 0.7, y - 0.01, 4.9, 0.25, {
      fontSize: 12,
      bold: true,
      color: C.navy,
    });
    addText(slide, body, MX + 0.7, y + 0.27, 4.9, 0.42, {
      fontSize: 9.3,
      color: C.slate,
      lineSpacingMultiple: 1.05,
    });
  });

  addText(
    slide,
    "Success is every gate closed with evidence — not a calendar date or a verbal assurance.",
    MX + 0.28,
    5.82,
    5.55,
    0.34,
    {
      fontSize: 8.8,
      italic: true,
      color: C.teal,
      lineSpacingMultiple: 1.03,
    },
  );

  // Timeline.
  addText(slide, "30 / 60 / 90", 7.1, 1.62, 2.2, 0.22, {
    fontSize: 9,
    bold: true,
    color: C.amber,
    charSpacing: 1.3,
  });
  addLine(slide, 7.33, 2.1, 0, 4.25, C.line, 1.4);
  const timeline = [
    ["NEXT 2 WEEKS", "Inputs, integration, real-host validation.", C.teal],
    ["30 DAYS", "Off-host restore, monitoring, production go/no-go.", C.blue],
    ["60–90 DAYS", "Hardening, CI branch protection, HA decision.", C.amber],
  ];
  timeline.forEach(([when, what, color], index) => {
    const y = 2.18 + index * 1.35;
    slide.addShape(pptx.ShapeType.ellipse, {
      x: 7.17,
      y,
      w: 0.32,
      h: 0.32,
      fill: { color },
      line: { color, width: 0.5 },
    });
    addText(slide, when, 7.68, y - 0.02, 4.6, 0.22, {
      fontSize: 8.8,
      bold: true,
      color,
      charSpacing: 0.8,
    });
    addText(slide, what, 7.68, y + 0.26, 4.6, 0.48, {
      fontSize: 10.2,
      color: C.slate,
      lineSpacingMultiple: 1.05,
    });
  });

  addRect(slide, 7.1, 5.58, 5.6, 0.75, C.tealLight, { color: C.teal, width: 0.7 }, 0.08);
  addText(slide, "RECOMMENDATION", 7.3, 5.67, 1.7, 0.18, {
    fontSize: 8,
    bold: true,
    color: C.teal,
    charSpacing: 1.1,
  });
  addText(slide, "Proceed with the readiness sprint. No architecture change is required for v1.", 7.3, 5.88, 5.2, 0.32, {
    fontSize: 9.4,
    bold: true,
    color: C.tealDark,
    lineSpacingMultiple: 1.03,
  });

  addFooter(slide, 9);
  slide.addNotes(
    [
      "Four decisions are requested: approve the sprint, name the backup target, provide the production inputs, and confirm the v1 scope.",
      "The sprint is time-boxed: two weeks to close inputs, integration, and real-host validation. Go/no-go at the end.",
      "The 30-day path includes off-host restore, monitoring, and production approval. The 60–90 day path is hardening and a separate HA decision.",
      "Recommendation: proceed. The architecture does not need to change for v1; the operational gaps do.",
    ].join("\n\n"),
  );
}

// ---------------------------------------------------------------------------
// Slide 10 — Appendix: validation ledger
// ---------------------------------------------------------------------------
{
  const slide = pptx.addSlide();
  addHeader(slide, "Appendix", "Validation ledger: what is proven, what is pending.");

  addRect(slide, MX, 1.58, 5.95, 4.35, C.white, { color: C.line, width: 0.7 });
  addRect(slide, MX, 1.58, 5.95, 0.07, C.green, null, 0);
  addText(slide, "PROVEN", MX + 0.24, 1.78, 4.5, 0.22, {
    fontSize: 9,
    bold: true,
    color: C.green,
    charSpacing: 1.4,
  });
  const proven = [
    "make lint, make syntax, policy checks: pass.",
    "gitleaks, actionlint, shellcheck, hadolint: pass.",
    "130 files linted; 0 failures.",
    "PostgreSQL 18.7 config, TLS, SCRAM, backup.",
    "MariaDB 11.8.10 config, TLS, auth, dump.",
    "Garage 2.5.0 layout, key, bucket, permissions.",
    "Elasticsearch 9.5.6 TLS and Garage snapshots.",
    "NGINX 1.26.3 TLS termination and proxy routing.",
  ];
  proven.forEach((item, index) => {
    addText(slide, `✓  ${item}`, MX + 0.24, 2.14 + index * 0.44, 5.4, 0.4, {
      fontSize: 9.1,
      color: C.slate,
      lineSpacingMultiple: 1.02,
    });
  });

  addRect(slide, 6.76, 1.58, 5.95, 4.35, C.white, { color: C.line, width: 0.7 });
  addRect(slide, 6.76, 1.58, 5.95, 0.07, C.amber, null, 0);
  addText(slide, "PENDING", 7.0, 1.78, 4.5, 0.22, {
    fontSize: 9,
    bold: true,
    color: C.amber,
    charSpacing: 1.4,
  });
  const pending = [
    "Docker/Molecule converge and idempotence.",
    "Full-stack site.yml integration.",
    "GitHub Actions run and branch protection.",
    "Let's Encrypt DNS-01 and Cloudflare API.",
    "SELinux httpd_t upstream port policy.",
    "firewalld allow/deny against a real network.",
    "Off-host backup and restore test.",
    "Monitoring, alerting, and runbooks.",
  ];
  pending.forEach((item, index) => {
    addText(slide, `○  ${item}`, 7.0, 2.14 + index * 0.44, 5.4, 0.4, {
      fontSize: 9.1,
      color: C.slate,
      lineSpacingMultiple: 1.02,
    });
  });

  // Component versions strip.
  addText(slide, "PINNED COMPONENTS", MX, 6.1, 3.0, 0.2, {
    fontSize: 8,
    bold: true,
    color: C.muted,
    charSpacing: 1.1,
  });
  const versions = [
    "PostgreSQL 18.7",
    "MariaDB 11.8.10",
    "Garage 2.5.0",
    "Elasticsearch 9.5.6",
    "NGINX 1.26.3",
    "Certbot 5.10.0",
  ];
  versions.forEach((version, index) => {
    const x = MX + index * 2.0;
    addChip(slide, version, x, 6.32, 1.88, 0.26, C.paper, C.slate, { color: C.line, width: 0.5 }, 7.4, false);
  });

  addText(
    slide,
    "Source of truth: docs/COMPONENTS.md  ·  docs/TESTING.md  ·  docs/components/nginx.md  ·  docs/executive/README.md",
    MX,
    6.73,
    12.0,
    0.18,
    {
      fontSize: 8,
      color: C.muted,
    },
  );

  addFooter(slide, 10);
  slide.addNotes(
    [
      "This appendix is the evidence ledger. It separates what has actually been exercised from what remains.",
      "Proven: static checks, policy, secret scanning, real-binary service tests, and the Elasticsearch snapshot flow.",
      "Pending: Docker/Molecule execution, full-stack integration, CI, real-host certificate and SELinux checks, firewalld behavior, off-host restore, and monitoring.",
      "Component versions are pinned; updates are deliberate changes, not automatic upgrades.",
    ].join("\n\n"),
  );
}

fs.mkdirSync(EXPORTS, { recursive: true });
await pptx.writeFile({ fileName: OUTPUT });
console.log(`Wrote ${OUTPUT}`);
