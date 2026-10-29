// CRM server — v17-compatible backend.
// Requires Node.js 20+ and the matching support files listed above.

const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const E = process.env;
const PORT = E.PORT || 3000;
const KEY = E.API_KEY || "";
const BASE = (E.PUBLIC_URL || "").replace(/\/$/, "");

const SU = (E.SUPABASE_URL || "").replace(/\/$/, "");
const SK = E.SUPABASE_KEY || "";
const OWNER = String(E.OWNER || "").trim().toLowerCase();
const SECRET = E.AUTH_SECRET || "";

const SC = require("./security-core.cjs");

const FD = path.join(__dirname, "files");
fs.mkdirSync(FD, { recursive: true });

const H = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "Content-Type,x-api-key,Authorization",
  "Access-Control-Allow-Methods": "GET,POST,PUT,OPTIONS"
};

const out = (res, code, value) => {
  res.writeHead(code, {
    "Content-Type": "application/json",
    ...H
  });
  res.end(JSON.stringify(value));
};

const body = req =>
  new Promise((resolve, reject) => {
    let text = "";

    req.on("data", chunk => {
      text += chunk;

      if (text.length > 40e6) {
        reject(new Error("Too large"));
        req.destroy();
      }
    });

    req.on("end", () => {
      try {
        resolve(text ? JSON.parse(text) : {});
      } catch (error) {
        reject(error);
      }
    });

    req.on("error", reject);
  });

/* ---------------- Database ---------------- */

const dbh = () => {
  const headers = {
    apikey: SK,
    "Content-Type": "application/json"
  };

  if (SK.startsWith("eyJ")) {
    headers.Authorization = "Bearer " + SK;
  }

  return headers;
};

async function dbGet(key, columns) {
  const response = await fetch(
    `${SU}/rest/v1/kv?key=eq.${key}&select=${columns}`,
    { headers: dbh() }
  );

  if (!response.ok) {
    throw new Error(
      "DB read failed " +
        response.status +
        " " +
        (await response.text()).slice(0, 150)
    );
  }

  return (await response.json())[0] || null;
}

async function dbCas(key, base, value) {
  let response;

  if (!base) {
    response = await fetch(
      `${SU}/rest/v1/kv?on_conflict=key`,
      {
        method: "POST",
        headers: {
          ...dbh(),
          Prefer: "resolution=ignore-duplicates,return=representation"
        },
        body: JSON.stringify({
          key,
          ver: 1,
          value
        })
      }
    );
  } else {
    response = await fetch(
      `${SU}/rest/v1/kv?key=eq.${key}&ver=eq.${base}&select=ver`,
      {
        method: "PATCH",
        headers: {
          ...dbh(),
          Prefer: "return=representation"
        },
        body: JSON.stringify({
          ver: base + 1,
          value
        })
      }
    );
  }

  if (!response.ok) {
    throw new Error(
      "DB write failed " +
        response.status +
        " " +
        (await response.text()).slice(0, 150)
    );
  }

  return (await response.json()).length ? base + 1 : null;
}

/* ---------------- Users ---------------- */

let UC = null;
let UT = 0;

async function users() {
  const row = await dbGet("users", "ver,value");

  const sealed = await SECURITY.checkStored(
    "users",
    row,
    true
  );

  UC = {
    ver: row ? row.ver : 0,
    list: row ? row.value.list || [] : [],
    sealed
  };

  UT = Date.now();

  return UC;
}

async function saveUsers(
  mutate,
  actor = null,
  action = "account-registration"
) {
  for (let attempt = 0; attempt < 6; attempt++) {
    UC = null;

    const current = await users();

    if (
      current.list.length &&
      !current.sealed &&
      !SC.isSuper(actor)
    ) {
      SC.fail(
        503,
        "Super Admin must initialize the security baseline first."
      );
    }

    const list = JSON.parse(JSON.stringify(current.list));
    const result = mutate(list);

    if (result && result.err) {
      return result;
    }

    const ids = new Set([
      ...current.list.map(user => user.id),
      ...list.map(user => user.id)
    ]);

    const changes = [];

    for (const id of ids) {
      const oldUser = current.list.find(user => user.id === id);
      const nextUser = list.find(user => user.id === id);

      if (!SC.equal(oldUser, nextUser)) {
        changes.push({
          collection: "users",
          id,
          company: "",
          before: oldUser ? pub(oldUser) : null,
          after: nextUser ? pub(nextUser) : null,
          credentialChanged: !!(
            oldUser &&
            nextUser &&
            (
              oldUser.h !== nextUser.h ||
              oldUser.salt !== nextUser.salt
            )
          )
        });
      }
    }

    const committed = await SECURITY.commit(
      "users",
      current.ver,
      { list },
      actor,
      action,
      changes
    );

    if (committed.ok) {
      UC = null;
      return result;
    }
  }

  throw new Error("Users busy, try again");
}

const normId = value => {
  value = String(value || "").trim().toLowerCase();

  if (/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(value)) {
    return { em: value };
  }

  const digits = value.replace(/\D/g, "");

  return digits.length >= 10
    ? { ph: digits.slice(-10) }
    : null;
};

const findU = (list, id) => {
  const normalized = normId(id);

  return normalized
    ? list.find(
        user =>
          (
            normalized.em &&
            user.em === normalized.em
          ) ||
          (
            normalized.ph &&
            user.ph === normalized.ph
          )
      )
    : null;
};

const hp = (password, salt) =>
  crypto
    .scryptSync(String(password), salt, 32)
    .toString("hex");

const pub = SC.pub;
const same = SC.safeEqual;

const sign = value =>
  crypto
    .createHmac("sha256", SECRET)
    .update(value)
    .digest("hex");

const mkTok = user => {
  const payload =
    user.id +
    "." +
    (Date.now() + 30 * 864e5) +
    "." +
    (user.av || 0);

  return payload + "." + sign(payload);
};

async function auth(req) {
  const token = String(req.headers.authorization || "")
    .replace(/^Bearer /, "");

  const parts = token.split(".");

  if (
    SECRET.length < 32 ||
    parts.length !== 4 ||
    !same(sign(parts.slice(0, 3).join(".")), parts[3]) ||
    +parts[1] < Date.now()
  ) {
    return null;
  }

  const current = await users();
  const user = current.list.find(item => item.id === parts[0]);

  const allowedOwnerBootstrap =
    user?.role === "super" &&
    OWNER &&
    (
      (user.em && user.em === OWNER) ||
      (
        user.ph &&
        OWNER.replace(/\D/g, "").slice(-10) === user.ph
      )
    );

  if (!current.sealed && !allowedOwnerBootstrap) {
    return null;
  }

  return (
    user &&
    user.status === "active" &&
    String(user.av || 0) === parts[2]
  )
    ? user
    : null;
}

/* ---------------- Security and statement routes ---------------- */

const SECURITY = require("./security-service.cjs")({
  url: SU,
  headers: dbh,
  dbGet,
  key: E.AUDIT_SIGNING_KEY || ""
});

const securityRoutes = require("./security-routes.cjs")({
  service: SECURITY,
  dbGet,
  users,
  saveUsers,
  out,
  body
});

// The matching v17 statements-routes.cjs implements:
// GET /statements/preferences
// PUT /statements/preferences
// POST /statements/report
const statementRoutes = require("./statements-routes.cjs")({
  service: SECURITY,
  out,
  body,
  saveUsers
});

/* ---------------- Login throttling ---------------- */

const tries = new Map();

const blocked = key => {
  const item = tries.get(key);

  return (
    item &&
    item.n >= 6 &&
    Date.now() - item.t < 6e5
  );
};

const fail = key => {
  const item = tries.get(key) || { n: 0, t: 0 };
  item.n++;
  item.t = Date.now();
  tries.set(key, item);
};

/* ---------------- Sending ---------------- */

const has = {
  email: () =>
    !!(
      E.BREVO_API_KEY ||
      (E.SMTP_USER && E.SMTP_PASS)
    ),

  whatsapp: () =>
    !!(E.WA_TOKEN && E.WA_PHONE_ID),

  sms: () =>
    !!(
      E.TWILIO_SID &&
      E.TWILIO_TOKEN &&
      E.TWILIO_FROM &&
      BASE
    )
};

async function email(data) {
  if (E.BREVO_API_KEY) {
    const response = await fetch(
      "https://api.brevo.com/v3/smtp/email",
      {
        method: "POST",
        headers: {
          "api-key": E.BREVO_API_KEY,
          "Content-Type": "application/json",
          accept: "application/json"
        },
        body: JSON.stringify({
          sender: {
            name: data.company,
            email: E.BREVO_SENDER || E.SMTP_USER
          },
          to: [
            {
              email: data.to,
              name: data.name
            }
          ],
          subject:
            `${data.company} - Advance statement ${data.month}`,
          textContent: data.text,
          attachment: [
            {
              name: data.filename,
              content: data.pdf
            }
          ]
        })
      }
    );

    if (!response.ok) {
      const result = await response.json().catch(() => ({}));

      throw new Error(
        result.message || "Brevo error " + response.status
      );
    }

    return;
  }

  const transport = require("nodemailer").createTransport({
    host: E.SMTP_HOST || "smtp.gmail.com",
    port: +(E.SMTP_PORT || 465),
    secure: +(E.SMTP_PORT || 465) === 465,
    auth: {
      user: E.SMTP_USER,
      pass: E.SMTP_PASS
    }
  });

  await transport.sendMail({
    from: `"${data.company}" <${E.SMTP_USER}>`,
    to: data.to,
    subject:
      `${data.company} - Advance statement ${data.month}`,
    text: data.text,
    attachments: [
      {
        filename: data.filename,
        content: Buffer.from(data.pdf, "base64"),
        contentType: "application/pdf"
      }
    ]
  });
}

async function whatsapp(data) {
  const base =
    "https://graph.facebook.com/v20.0/" + E.WA_PHONE_ID;

  const headers = {
    Authorization: "Bearer " + E.WA_TOKEN
  };

  const form = new FormData();

  form.append("messaging_product", "whatsapp");
  form.append("type", "application/pdf");

  form.append(
    "file",
    new Blob(
      [Buffer.from(data.pdf, "base64")],
      { type: "application/pdf" }
    ),
    data.filename
  );

  let response = await fetch(base + "/media", {
    method: "POST",
    headers,
    body: form
  });

  let result = await response.json();

  if (!result.id) {
    throw new Error(
      (result.error && result.error.message) ||
      "WhatsApp upload failed"
    );
  }

  const message = E.WA_TEMPLATE
    ? {
        type: "template",
        template: {
          name: E.WA_TEMPLATE,
          language: {
            code: E.WA_LANG || "en"
          },
          components: [
            {
              type: "header",
              parameters: [
                {
                  type: "document",
                  document: {
                    id: result.id,
                    filename: data.filename
                  }
                }
              ]
            },
            {
              type: "body",
              parameters: [
                data.name,
                data.month,
                String(Math.round(data.amount))
              ].map(text => ({
                type: "text",
                text
              }))
            }
          ]
        }
      }
    : {
        type: "document",
        document: {
          id: result.id,
          filename: data.filename,
          caption: data.text
        }
      };

  response = await fetch(base + "/messages", {
    method: "POST",
    headers: {
      ...headers,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      messaging_product: "whatsapp",
      to: data.to,
      ...message
    })
  });

  result = await response.json();

  if (result.error) {
    throw new Error(result.error.message);
  }
}

async function sms(data) {
  const token = crypto.randomBytes(12).toString("hex");

  fs.writeFileSync(
    path.join(FD, token + ".pdf"),
    Buffer.from(data.pdf, "base64")
  );

  const payload = new URLSearchParams({
    To: "+" + data.to,
    From: E.TWILIO_FROM,
    Body:
      `${data.company}: ${data.month} advance baaki ` +
      `Rs ${Math.round(data.amount)}. ` +
      `Statement: ${BASE}/f/${token}.pdf`
  });

  const response = await fetch(
    `https://api.twilio.com/2010-04-01/Accounts/` +
      `${E.TWILIO_SID}/Messages.json`,
    {
      method: "POST",
      headers: {
        Authorization:
          "Basic " +
          Buffer.from(
            E.TWILIO_SID + ":" + E.TWILIO_TOKEN
          ).toString("base64"),
        "Content-Type": "application/x-www-form-urlencoded"
      },
      body: payload
    }
  );

  const result = await response.json();

  if (result.code || result.error_message) {
    throw new Error(result.message || result.error_message);
  }
}

const CH = { email, whatsapp, sms };

/* ---------------- HTML selection ---------------- */

const ver = filename =>
  +((filename.match(/v(\d+)/i) || [0, 0])[1]);

const page = () => {
  const files = fs
    .readdirSync(__dirname)
    .filter(filename => /^crm.*\.html$/i.test(filename))
    .sort(
      (a, b) =>
        ver(a) - ver(b) ||
        a.localeCompare(b)
    );

  return files.length
    ? path.join(__dirname, files[files.length - 1])
    : null;
};

/* ---------------- HTTP routes ---------------- */

const app = http.createServer(async (req, res) => {
  try {
    const url = req.url.split("?")[0];
    const method = req.method;

    if (method === "OPTIONS") {
      res.writeHead(204, H);
      return res.end();
    }

    if (
      method === "GET" &&
      /^\/f\/[a-f0-9]{24}\.pdf$/.test(url)
    ) {
      const file = path.join(FD, path.basename(url));

      if (!fs.existsSync(file)) {
        return out(res, 404, { error: "Not found" });
      }

      res.writeHead(200, {
        "Content-Type": "application/pdf",
        ...H
      });

      return res.end(fs.readFileSync(file));
    }

    if (
      method === "GET" &&
      (url === "/" || url === "/crm.html")
    ) {
      const file = page();

      if (!file) {
        return out(res, 404, {
          error: "Put crm_v17.html next to server.js"
        });
      }

      res.writeHead(200, {
        "Content-Type": "text/html; charset=utf-8",
        "Cache-Control": "no-store"
      });

      return res.end(fs.readFileSync(file));
    }

    if (
      method === "GET" &&
      url === "/auth/status"
    ) {
      return out(res, 200, {
        server: true,
        storage: !!(SU && SK),
        owner: !!OWNER,
        securityVersion: 15,
        securityConfigured:
          SECRET.length >= 32 &&
          (E.AUDIT_SIGNING_KEY || "").length >= 32
      });
    }

    const protectedPrefix =
      url.startsWith("/auth/") ||
      url.startsWith("/security") ||
      url.startsWith("/statements") ||
      url.startsWith("/data");

    if (
      protectedPrefix &&
      (
        SECRET.length < 32 ||
        (E.AUDIT_SIGNING_KEY || "").length < 32
      )
    ) {
      return out(res, 503, {
        error:
          "Set AUTH_SECRET and a separate AUDIT_SIGNING_KEY " +
          "(32+ random characters each); apply " +
          "migrations/015_security.sql."
      });
    }

    const needsDatabase =
      url.startsWith("/auth") ||
      [
        "/data",
        "/users",
        "/me",
        "/security",
        "/statements"
      ].some(prefix => url.startsWith(prefix));

    if (!(SU && SK) && needsDatabase) {
      return out(res, 500, {
        error:
          "Server par SUPABASE_URL / SUPABASE_KEY set nahi hai"
      });
    }

    /* Registration */

    if (
      method === "POST" &&
      url === "/auth/register"
    ) {
      const data = await body(req);
      const normalized = normId(data.id);

      if (!normalized) {
        return out(res, 400, {
          error: "Sahi Gmail ya 10 digit mobile number likho"
        });
      }

      if (String(data.password || "").length < 6) {
        return out(res, 400, {
          error: "Password kam se kam 6 akshar ka ho"
        });
      }

      const name =
        String(data.name || "").trim().slice(0, 40) ||
        "User";

      const result = await saveUsers(list => {
        if (findU(list, data.id)) {
          return {
            err: "Ye Gmail / number pehle se registered hai"
          };
        }

        const first = !list.length;

        const ownerMatches =
          OWNER &&
          (
            (
              normalized.em &&
              normalized.em === OWNER
            ) ||
            (
              normalized.ph &&
              OWNER.replace(/\D/g, "").slice(-10) ===
                normalized.ph
            )
          );

        if (first && !ownerMatches) {
          return {
            err:
              "Pehla account sirf owner ka ho sakta hai. " +
              "Hosting environment mein OWNER set karo."
          };
        }

        const salt = crypto.randomBytes(8).toString("hex");

        list.push({
          id: crypto.randomBytes(6).toString("hex"),
          name,
          ...normalized,
          salt,
          h: hp(data.password, salt),
          role: first ? "super" : "admin",
          status: first ? "active" : "pending",
          at: new Date().toISOString()
        });

        return {
          ok: true,
          status: first ? "active" : "pending"
        };
      });

      return result.err
        ? out(res, 400, { error: result.err })
        : out(res, 200, result);
    }

    /* Login */

    if (
      method === "POST" &&
      url === "/auth/login"
    ) {
      const data = await body(req);

      const throttleKey =
        (req.socket.remoteAddress || "") +
        "|" +
        String(data.id).toLowerCase();

      if (blocked(throttleKey)) {
        return out(res, 429, {
          error: "Bahut galat try. 10 minute baad dobara karo."
        });
      }

      const current = await users();
      const user = findU(current.list, data.id);

      if (
        !user ||
        !same(hp(data.password || "", user.salt), user.h)
      ) {
        fail(throttleKey);

        return out(res, 401, {
          error: "Gmail/number ya password galat hai"
        });
      }

      const ownerMatches =
        user.role === "super" &&
        OWNER &&
        (
          (user.em && user.em === OWNER) ||
          (
            user.ph &&
            OWNER.replace(/\D/g, "").slice(-10) === user.ph
          )
        );

      if (!current.sealed && !ownerMatches) {
        return out(res, 403, {
          error:
            "Super Admin must initialize Security Center first."
        });
      }

      if (user.status === "pending") {
        return out(res, 403, {
          error:
            "Aapki request Super Admin ke paas hai. " +
            "Approve hone par login chalega."
        });
      }

      if (user.status !== "active") {
        return out(res, 403, {
          error:
            "Ye account band hai. Super Admin se baat karo."
        });
      }

      tries.delete(throttleKey);

      return out(res, 200, {
        token: mkTok(user),
        user: pub(user)
      });
    }

    /* Existing statement delivery */

    if (
      method === "POST" &&
      url === "/send"
    ) {
      const me = await auth(req);

      if (!me) {
        return out(res, 401, {
          error:
            "Login required. API-key-only sending is disabled " +
            "for company security."
        });
      }

      SC.writer(me);

      const data = await body(req);
      const { env } = await SECURITY.readData(me);

      const worker = (env.data.w || []).find(
        item => String(item.id) === String(data.workerId)
      );

      if (!worker || !SC.can(me, worker.c)) {
        return out(res, 403, {
          error: "Worker/company access denied."
        });
      }

      if (!CH[data.channel]) {
        return out(res, 400, {
          error: "Unknown channel"
       
