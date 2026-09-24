/**
 * Minimal client for the FacturaScripts REST API (v3), the open-source invoicing
 * software many Spanish SMEs use. We drive it to obtain invoices laid out by
 * real software instead of by our own templates.
 */

type Fetch = (
  input: string | URL | Request,
  init?: RequestInit,
) => Promise<Response>;

export type ErpLine = {
  description: string;
  quantity: number;
  unitPriceCents: number;
  vatRateBps: number;
  irpfBps?: number;
};

/** Totals as FacturaScripts computed and printed them, converted to cents. */
export type ErpInvoice = {
  id: number;
  number: string;
  taxBaseCents: number;
  vatAmountCents: number;
  withholdingCents: number;
  totalCents: number;
};

/** FacturaScripts statuses for customer invoices: 10 = draft, 11 = issued. */
const ISSUED_STATUS = "11";

const toCents = (euros: number) => Math.round(euros * 100);

/** "C/ Mayor 3, 41001 Sevilla" → FacturaScripts address fields (province = city here). */
function addressFields(address: string): Record<string, string> {
  const [street = "", place = ""] = address.split(", ");
  const [postcode = "", ...city] = place.split(" ");
  const cityName = city.join(" ");
  return {
    direccion: street,
    codpostal: postcode,
    ciudad: cityName,
    provincia: cityName,
  };
}
const toEuros = (cents: number) => cents / 100;
/** "2026-09-24" → "24-09-2026", the date format the API expects. */
const toErpDate = (iso: string) => iso.split("-").reverse().join("-");

export class FacturaScriptsClient {
  constructor(
    private readonly baseUrl: string,
    private readonly apiKey: string,
    private readonly fetchImpl: Fetch = fetch,
  ) {}

  private async request(
    method: string,
    path: string,
    fields?: Record<string, string>,
  ): Promise<Response> {
    const response = await this.fetchImpl(`${this.baseUrl}/api/3/${path}`, {
      method,
      headers: {
        Token: this.apiKey,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      ...(fields ? { body: new URLSearchParams(fields).toString() } : {}),
    });
    if (!response.ok) {
      // Errors come back as an HTML page; keep only readable text.
      const text = (await response.text())
        .replace(/<[^>]*>/g, " ")
        .replace(/\s+/g, " ")
        .trim();
      throw new Error(
        `FacturaScripts ${method} ${path} failed (${response.status}): ${text.slice(0, 300)}`,
      );
    }
    return response;
  }

  private async json<T>(
    method: string,
    path: string,
    fields?: Record<string, string>,
  ): Promise<T> {
    return (await (await this.request(method, path, fields)).json()) as T;
  }

  /** FacturaScripts issues invoices as its (single) company; we rename it per invoice. */
  async setCompany(company: {
    name: string;
    taxId: string;
    address: string;
  }): Promise<void> {
    await this.json("PUT", "empresas/1", {
      nombre: company.name,
      nombrecorto: company.name.slice(0, 32),
      cifnif: company.taxId,
      ...addressFields(company.address),
    });
  }

  /** Creates a customer and fills in the billing contact FacturaScripts creates for it. */
  async upsertCustomer(customer: {
    code: string;
    name: string;
    taxId?: string;
    address: string;
  }): Promise<void> {
    await this.json("POST", "clientes", {
      codcliente: customer.code,
      nombre: customer.name,
      razonsocial: customer.name,
      cifnif: customer.taxId ?? "",
    });
    const { idcontactofact } = await this.json<{ idcontactofact: number }>(
      "GET",
      `clientes/${encodeURIComponent(customer.code)}`,
    );
    await this.json(
      "PUT",
      `contactos/${idcontactofact}`,
      addressFields(customer.address),
    );
  }

  async createInvoice(input: {
    customerCode: string;
    issueDate: string;
    lines: ErpLine[];
  }): Promise<ErpInvoice> {
    const lines = input.lines.map((l) => ({
      descripcion: l.description,
      cantidad: l.quantity,
      pvpunitario: toEuros(l.unitPriceCents),
      codimpuesto: `IVA${l.vatRateBps / 100}`,
      ...(l.irpfBps ? { irpf: l.irpfBps / 100 } : {}),
    }));
    const { doc } = await this.json<{
      doc: {
        idfactura: number;
        codigo: string;
        neto: number;
        totaliva: number;
        totalirpf: number;
        total: number;
      };
    }>("POST", "crearFacturaCliente", {
      codcliente: input.customerCode,
      fecha: toErpDate(input.issueDate),
      lineas: JSON.stringify(lines),
    });
    return {
      id: doc.idfactura,
      number: doc.codigo,
      taxBaseCents: toCents(doc.neto),
      vatAmountCents: toCents(doc.totaliva),
      withholdingCents: toCents(doc.totalirpf),
      totalCents: toCents(doc.total),
    };
  }

  /** Drafts are printed with a "boceto" watermark; issued invoices are not. */
  async issueInvoice(id: number): Promise<void> {
    await this.json("PUT", `facturaclientes/${id}`, {
      idestado: ISSUED_STATUS,
    });
  }

  async exportInvoicePdf(id: number): Promise<Buffer> {
    const response = await this.request(
      "GET",
      `exportarFacturaCliente/${id}?type=PDF`,
    );
    return Buffer.from(await response.arrayBuffer());
  }
}
