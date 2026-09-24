import { describe, expect, it } from "vitest";
import { FacturaScriptsClient } from "./facturascripts.js";

type Call = { method: string; url: string; body: Record<string, string> };

/** A fake fetch that records calls and answers from a routing table. */
function fakeFetch(routes: Record<string, unknown>) {
  const calls: Call[] = [];
  const fetchImpl = async (
    input: string | URL | Request,
    init?: RequestInit,
  ) => {
    const url = String(input);
    const method = init?.method ?? "GET";
    const body = Object.fromEntries(
      new URLSearchParams(String(init?.body ?? "")),
    );
    calls.push({ method, url, body });
    const key = `${method} ${new URL(url).pathname}`;
    if (!(key in routes)) return new Response("not found", { status: 404 });
    const value = routes[key];
    return value instanceof ArrayBuffer
      ? new Response(value, {
          headers: { "content-type": "application/pdf" },
        })
      : Response.json(value);
  };
  return { calls, fetchImpl };
}

const BASE = "http://erp.test";

describe("FacturaScriptsClient", () => {
  it("sends the API token and form-encoded fields", async () => {
    const { calls, fetchImpl } = fakeFetch({
      "PUT /api/3/empresas/1": { ok: "saved" },
    });
    const client = new FacturaScriptsClient(BASE, "secret", fetchImpl);

    await client.setCompany({
      name: "Aceites García S.L.",
      taxId: "B12345674",
      address: "C/ Mayor 1, 23001 Jaén",
    });

    expect(calls[0]?.method).toBe("PUT");
    expect(calls[0]?.body).toMatchObject({
      nombre: "Aceites García S.L.",
      cifnif: "B12345674",
    });
  });

  it("fills in the billing contact FacturaScripts creates for each customer", async () => {
    const { calls, fetchImpl } = fakeFetch({
      "POST /api/3/clientes": { ok: "saved" },
      "GET /api/3/clientes/C1": { codcliente: "C1", idcontactofact: 42 },
      "PUT /api/3/contactos/42": { ok: "saved" },
    });
    const client = new FacturaScriptsClient(BASE, "secret", fetchImpl);

    await client.upsertCustomer({
      code: "C1",
      name: "Bar Sol",
      address: "C/ Mayor 3, 41001 Sevilla",
    });

    expect(calls.at(-1)?.body).toMatchObject({
      direccion: "C/ Mayor 3",
      codpostal: "41001",
      ciudad: "Sevilla",
      provincia: "Sevilla",
    });
  });

  it("creates an invoice with one line per item, in euros, with VAT and IRPF codes", async () => {
    const { calls, fetchImpl } = fakeFetch({
      "POST /api/3/crearFacturaCliente": {
        doc: {
          idfactura: 7,
          codigo: "F2026A7",
          fecha: "24-09-2026",
          neto: 100,
          totaliva: 21,
          totalirpf: 15,
          total: 106,
        },
      },
    });
    const client = new FacturaScriptsClient(BASE, "secret", fetchImpl);

    const created = await client.createInvoice({
      customerCode: "C1",
      issueDate: "2026-09-24",
      lines: [
        {
          description: "Consultoría",
          quantity: 1,
          unitPriceCents: 10000,
          vatRateBps: 2100,
          irpfBps: 1500,
        },
      ],
    });

    const body = calls[0]?.body ?? {};
    expect(body.fecha).toBe("24-09-2026");
    expect(JSON.parse(body.lineas ?? "[]")).toEqual([
      {
        descripcion: "Consultoría",
        cantidad: 1,
        pvpunitario: 100,
        codimpuesto: "IVA21",
        irpf: 15,
      },
    ]);
    expect(created).toEqual({
      id: 7,
      number: "F2026A7",
      taxBaseCents: 10000,
      vatAmountCents: 2100,
      withholdingCents: 1500,
      totalCents: 10600,
    });
  });

  it("turns an HTML error page into a readable exception", async () => {
    const fetchImpl = async () =>
      new Response("<h1>Error</h1> Uncaught TypeError: boom", { status: 500 });
    const client = new FacturaScriptsClient(BASE, "secret", fetchImpl);
    await expect(client.issueInvoice(1)).rejects.toThrow(
      /FacturaScripts PUT .*500/,
    );
  });

  it("downloads the invoice PDF", async () => {
    const pdf = new TextEncoder().encode("%PDF-1.7 fake").buffer as ArrayBuffer;
    const { fetchImpl } = fakeFetch({
      "GET /api/3/exportarFacturaCliente/7": pdf,
    });
    const client = new FacturaScriptsClient(BASE, "secret", fetchImpl);

    const bytes = await client.exportInvoicePdf(7);
    expect(bytes.subarray(0, 4).toString()).toBe("%PDF");
  });
});
