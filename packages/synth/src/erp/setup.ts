import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

/**
 * One-time, unattended setup of the local FacturaScripts (see infra/erp):
 * installer → API key → first login and setup wizard → create all tables.
 * Every step is idempotent, so it can be re-run safely.
 * Credentials are for a throwaway local container only.
 */
export const ERP_URL = process.env.ERP_URL ?? "http://127.0.0.1:8081";
export const ERP_API_KEY = process.env.ERP_API_KEY ?? "erp_local_only_key";
const ADMIN_PASSWORD = "admin_local_only";
const COMPOSE_FILE = fileURLToPath(
  new URL("../../../../infra/erp/docker-compose.yml", import.meta.url),
);

/** A tiny browser session: keeps cookies and follows redirects by hand. */
class Session {
  private cookies = new Map<string, string>();

  async send(path: string, form?: Record<string, string>): Promise<string> {
    let url = `${ERP_URL}${path}`;
    let init: RequestInit = form
      ? { method: "POST", body: new URLSearchParams(form) }
      : { method: "GET" };
    for (let hop = 0; hop < 5; hop++) {
      const response = await fetch(url, {
        ...init,
        redirect: "manual",
        headers: {
          Cookie: [...this.cookies].map(([k, v]) => `${k}=${v}`).join("; "),
        },
      });
      for (const cookie of response.headers.getSetCookie()) {
        const [pair = ""] = cookie.split(";");
        const [name = "", value = ""] = pair.split("=");
        this.cookies.set(name, value);
      }
      const location = response.headers.get("location");
      if (!location) return response.text();
      url = new URL(location, url).toString();
      init = { method: "GET" };
    }
    throw new Error(`Too many redirects for ${path}`);
  }
}

const token = (html: string) =>
  /name="multireqtoken" value="([^"]+)"/.exec(html)?.[1] ?? "";

function compose(...args: string[]): string {
  return execFileSync("docker", ["compose", "-f", COMPOSE_FILE, ...args], {
    encoding: "utf8",
  });
}

async function waitForHttp(): Promise<void> {
  for (let i = 0; i < 60; i++) {
    try {
      if ((await fetch(ERP_URL)).status < 500) return;
    } catch {
      // container still starting
    }
    await new Promise((resolve) => setTimeout(resolve, 2000));
  }
  throw new Error(`FacturaScripts did not answer at ${ERP_URL}`);
}

export async function setupFacturaScripts(
  log: (msg: string) => void = console.log,
): Promise<void> {
  await waitForHttp();
  const session = new Session();

  const home = await session.send("/");
  if (home.includes('name="fs_db_host"')) {
    await session.send("/", {
      fs_db_type: "mysql",
      fs_db_host: "mysql",
      fs_db_port: "3306",
      fs_db_name: "facturascripts",
      fs_db_user: "root",
      fs_db_pass: "erp_local_only",
      // The web form always sends these, empty; without them the installer crashes.
      mysql_socket: "",
      pgsql_ssl_mode: "",
      pgsql_endpoint: "",
      fs_lang: "es_ES",
      fs_timezone: "Europe/Madrid",
      fs_initial_user: "admin",
      fs_initial_pass: ADMIN_PASSWORD,
      fs_install: "true",
    });
    log("✔ installed");
  }

  const config = compose(
    "exec",
    "-T",
    "facturascripts",
    "cat",
    "/var/www/html/config.php",
  );
  if (!config.includes("FS_API_KEY")) {
    compose(
      "exec",
      "-T",
      "facturascripts",
      "sh",
      "-c",
      `echo "define('FS_API_KEY', '${ERP_API_KEY}');" >> /var/www/html/config.php`,
    );
    log("✔ API key configured");
  }

  const login = await session.send("/login");
  let page = await session.send("/login", {
    multireqtoken: token(login),
    action: "login",
    fsNick: "admin",
    fsPassword: ADMIN_PASSWORD,
  });
  if (page.includes('value="step1"')) {
    page = await session.send("/Wizard", {
      multireqtoken: token(page),
      action: "step1",
      empresa: "Invariant Demo S.L.",
      personafisica: "0",
      codpais: "ESP",
      cifnif: "B12345674",
      direccion: "C/ Mayor 1",
      codpostal: "28001",
      ciudad: "Madrid",
      provincia: "Madrid",
    });
  }
  if (page.includes('value="step2"')) {
    await session.send("/Wizard", {
      multireqtoken: token(page),
      action: "step2",
      tipoidfiscal: "CIF",
      cifnif: "B12345674",
      regimeniva: "General",
      codimpuesto: "IVA21",
      invoice_start_number: "1",
      codpago: "TRANS",
      defaultplan: "1",
      ventasinstock: "1",
    });
    log("✔ setup wizard completed");
  }

  compose(
    "exec",
    "-T",
    "facturascripts",
    "php",
    "/opt/invariant/bootstrap-tables.php",
  );
  log("✔ all tables created");

  const api = await fetch(`${ERP_URL}/api/3/`, {
    headers: { Token: ERP_API_KEY },
  });
  if (!api.ok) throw new Error(`API check failed: ${api.status}`);
  log(`✔ FacturaScripts ready at ${ERP_URL}`);
}
