/** Word lists for plausible (but invented) Spanish business documents. */

export type Product = {
  description: string;
  vatRateBps: number;
  /** Unit price range in cents. */
  price: [number, number];
  /** Sold by weight or volume, so quantities may have decimals. */
  fractional?: boolean;
};

export type Sector = {
  id: string;
  /** Self-employed professionals invoice with a NIF and withhold IRPF. */
  professional: boolean;
  names: readonly string[];
  products: readonly Product[];
};

export const SECTORS: readonly Sector[] = [
  {
    id: "food-wholesale",
    professional: false,
    names: [
      "Aceites",
      "Harinas",
      "Distribuciones Alimentarias",
      "Hortofrutícola",
      "Lácteos",
    ],
    products: [
      {
        description: "Aceite de oliva virgen extra 5 L",
        vatRateBps: 1000,
        price: [2200, 4500],
      },
      {
        description: "Harina de trigo (kg)",
        vatRateBps: 400,
        price: [80, 250],
        fractional: true,
      },
      { description: "Pan de barra", vatRateBps: 400, price: [40, 120] },
      { description: "Leche entera 1 L", vatRateBps: 400, price: [70, 140] },
      {
        description: "Tomate pera (kg)",
        vatRateBps: 400,
        price: [120, 320],
        fractional: true,
      },
      {
        description: "Ternera para guisar (kg)",
        vatRateBps: 1000,
        price: [900, 1800],
        fractional: true,
      },
      {
        description: "Agua mineral 1,5 L (pack 6)",
        vatRateBps: 1000,
        price: [180, 420],
      },
    ],
  },
  {
    id: "hospitality-supplies",
    professional: false,
    names: [
      "Suministros Hosteleros",
      "Distribuciones Levante",
      "Limpiezas Industriales",
    ],
    products: [
      {
        description: "Detergente industrial 10 L",
        vatRateBps: 2100,
        price: [1800, 4200],
      },
      {
        description: "Servilletas de papel (caja 500 u.)",
        vatRateBps: 2100,
        price: [700, 1600],
      },
      {
        description: "Guantes de nitrilo (caja 100 u.)",
        vatRateBps: 2100,
        price: [500, 1200],
      },
      {
        description: "Café en grano (kg)",
        vatRateBps: 1000,
        price: [1200, 2600],
        fractional: true,
      },
      {
        description: "Vasos desechables (paquete 50 u.)",
        vatRateBps: 2100,
        price: [150, 450],
      },
    ],
  },
  {
    id: "professional-services",
    professional: true,
    names: ["Asesoría", "Consultoría", "Diseño", "Mantenimiento Informático"],
    products: [
      {
        description: "Asesoría fiscal y contable (mes)",
        vatRateBps: 2100,
        price: [8000, 25000],
      },
      {
        description: "Horas de consultoría",
        vatRateBps: 2100,
        price: [4000, 9000],
      },
      {
        description: "Diseño de carta y menú",
        vatRateBps: 2100,
        price: [15000, 60000],
      },
      {
        description: "Mantenimiento de equipos (hora)",
        vatRateBps: 2100,
        price: [3500, 7000],
      },
    ],
  },
];

export const SURNAMES = [
  "García",
  "Martínez",
  "López",
  "Sánchez",
  "Pérez",
  "Gómez",
  "Ruiz",
  "Díaz",
];
export const FIRST_NAMES = [
  "María",
  "José",
  "Carmen",
  "Antonio",
  "Lucía",
  "Javier",
  "Elena",
  "Pablo",
];
export const CUSTOMERS = [
  "Restaurante Sol",
  "Bar La Plaza",
  "Cafetería Central",
  "Hotel Mirador",
  "Taberna El Puerto",
  "Pastelería Dulce Hogar",
];
export const CITIES = [
  ["Madrid", "28"],
  ["Barcelona", "08"],
  ["Valencia", "46"],
  ["Sevilla", "41"],
  ["Jaén", "23"],
  ["Bilbao", "48"],
  ["Zaragoza", "50"],
] as const;
export const STREETS = [
  "C/ Mayor",
  "Av. de la Constitución",
  "C/ del Olivar",
  "Pl. de España",
];
