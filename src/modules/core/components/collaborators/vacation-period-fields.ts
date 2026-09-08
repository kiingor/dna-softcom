import type { FieldDef } from "./tabs/SubResourceTab";

export const FERIAS_FIELDS: FieldDef[] = [
  { name: "start_date", label: "Início da competência", type: "date", required: true },
  { name: "end_date", label: "Fim da competência", type: "date", required: true },
  { name: "days_entitled", label: "Dias de direito", type: "number", defaultValue: 30, min: 1 },
  { name: "days_taken", label: "Dias gozados", type: "number", defaultValue: 0, min: 0 },
  { name: "days_sold", label: "Dias vendidos", type: "number", defaultValue: 0, min: 0 },
];
